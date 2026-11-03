# Spécification — Les mails préparés : un envoi du connecteur attend une relecture humaine

- Unité de backlog : **`CRM-128`** — « Les mails préparés : un envoi du connecteur MCP attend la relecture et l'envoi
  depuis l'interface web ».
- Arbitrages : `docs/JOURNAL.md`, décision **827** (une unité, prioritaire), décision **829** (les deux questions MCP et
  les deux choix de l'écran) ; INC-341, qui relève l'écart.
- Documents liés : `docs/SPEC-mcp.md` §5 (le jeton interne), §6.1 (la matrice), §9.2 *decies* (famille `messagerie`,
  révisée ici) ; `docs/SPEC-mail-subsystem.md` (la file `mail_outbox`, `queue_outbound_email`) ; `docs/SPEC-relances.md`
  (les séquences, inchangées) ; `docs/SPEC-permissions-rls.md` ; `docs/DESIGN_SYSTEM.md` §5.4 (inbox).
- État : **écrite le 2026-11-03, avant le code**, à partir des réponses du responsable (décision 829). Les passages
  marqués **[proposition]** sont des choix de rédaction de l'agent ; tout écart trouvé à la mesure revient au responsable.

---

## 1. La règle

Énoncée par le responsable (décision 821, INC-341) :

> « On doit pouvoir envoyer un mail complètement custom depuis le MCP comme on le ferait depuis le client webmail, mais
> il faut quand même le rattacher à son affaire. Les envois par MCP ne partent JAMAIS direct, et aucun détournement
> possible : ils finissent dans une file de mails préparés, qui nécessitent une interface web pour relecture et envoi.
> Les relances auto ne passent pas par cette interface. »

Cette règle a quatre conséquences :

1. **Le connecteur prépare, il n'envoie jamais.** `crm_mail_send` disparaît du catalogue. Son successeur,
   `crm_mail_prepare`, écrit un **mail préparé** et rend son identifiant. Aucun courrier ne sort.
2. **Aucun détournement** : la règle est tenue **par la base**, pas par le seul connecteur. Un appel porté par le jeton
   du connecteur est refusé par toute fonction qui ferait partir un courrier, même si un défaut du connecteur l'y
   conduisait (§4).
3. **L'envoi ne se fait que depuis l'interface web**, par la personne au nom de laquelle le mail a été préparé (§5),
   après relecture dans le formulaire d'envoi habituel.
4. **Les relances automatiques ne changent pas** : une séquence armée depuis l'écran envoie ses paliers comme avant,
   sans passer par la file des mails préparés (§4.3).

Un mail préparé est **rattaché à une affaire**, toujours : c'est l'affaire qui donne l'adresse de réponse et le fil où
le message paraîtra une fois envoyé.

## 2. Ce que l'unité livre, et ce qu'elle ne livre pas

**Livre** : la table `mail_drafts` et ses politiques ; trois fonctions (`prepare_email`, `send_email_draft`,
`discard_email_draft`) ; le refus, par la base, de tout envoi direct sous le jeton du connecteur ; trois outils du
connecteur (`crm_mail_prepare`, `crm_mail_draft_list`, `crm_mail_draft_discard`) en remplacement de `crm_mail_send` ;
l'entrée « Mails préparés » de l'inbox et la relecture dans le formulaire d'envoi ; le mail préparé sur la fiche de son
affaire ; le seed, le manuel, les preuves.

**Ne livre pas** :
- **Préparer un mail depuis l'écran** (un « brouillon » de l'interface) : non demandé. La fonction l'accepte (§3.3), aucun
  écran ne l'offre.
- **Modifier un mail préparé sans l'envoyer** : la relecture modifie le contenu dans le formulaire, et ce qui part est ce
  que la personne a sous les yeux au moment d'« Envoyer » (§3.4). Aucun enregistrement intermédiaire.
- **Les pièces jointes par le connecteur** : toujours exclues (`docs/SPEC-mcp.md` §9.2 *decies*). La personne peut en
  joindre au moment de la relecture, comme dans tout envoi depuis l'écran.
- **Une notification** à la préparation : le compteur de l'inbox suffit (§6.1). **[proposition]**
- **Une échéance** des mails préparés : un mail préparé attend tant que la personne ne l'a ni envoyé ni écarté.

## 3. Le modèle de données — migration au premier numéro libre après `0161`

### 3.1 La table `public.mail_drafts`

| Colonne | Type | Règle |
|---|---|---|
| `id` | `uuid` | clé, `gen_random_uuid()` |
| `workspace_id` | `uuid` | espace de l'affaire, non nul, `on delete cascade` |
| `card_id` | `uuid` | l'affaire, non nulle, `on delete cascade` (la purge de l'affaire emporte ses mails préparés) |
| `identity_id` | `uuid` | l'identité d'expédition proposée, `on delete set null` — la relecture en choisit une (§3.4) |
| `in_reply_to_message_id` | `uuid` | facultatif, un message **classé dans cette affaire**, `on delete set null` |
| `to_addrs`, `cc_addrs`, `bcc_addrs` | `text[]` | `to` : 1 à 50 adresses ; `cc` et `bcc` : 0 à 50 ; mêmes règles d'adresse que `queue_outbound_email` |
| `subject` | `text` | 0 à 998 caractères |
| `body_text` | `text` | 1 à 100 000 caractères |
| `origin` | `text` | `mcp` ou `web` : `mcp` quand la préparation vient du jeton du connecteur (§4.1) |
| `status` | `text` | `pending`, `sent`, `discarded` |
| `outbox_id` | `uuid` | l'envoi créé par `send_email_draft`, `on delete set null` ; non nul si et seulement si `status = 'sent'` |
| `created_by` | `uuid` | la personne au nom de laquelle le mail est préparé, `auth.uid()`, non nul |
| `created_at`, `updated_at` | `timestamptz` | `now()` |
| `sent_at`, `discarded_at` | `timestamptz` | posées par le passage à l'état correspondant |

Index : `(created_by, workspace_id, status, created_at)` pour la file de la personne ; `(card_id, status)` pour la fiche.

### 3.2 Les droits

- **RLS, lecture** : une ligne se lit si `created_by = auth.uid()` **et** que la personne lit l'affaire
  (`app.can_read_card(card_id)`). **Personne d'autre ne la lit**, administrateur compris (décision 829, question 3) : un
  mail préparé appartient à la personne, comme son identité d'expédition (INC-335).
- **Aucune écriture directe** : `authenticated` n'a que `SELECT` ; toute écriture passe par les trois fonctions.
  `anon` n'a rien.
- **`service_role`** lit et écrit, pour le seed et la maintenance.

### 3.3 `public.prepare_email(...) returns uuid`

Arguments : `p_card_id`, `p_identity_id` (facultatif), `p_to`, `p_subject`, `p_body_text`, `p_cc`, `p_bcc`,
`p_in_reply_to_message_id` (facultatifs). `SECURITY DEFINER`, `search_path` vide. **Contrôles, dans l'ordre** —
les mêmes codes que `queue_outbound_email`, pour que l'assistant reçoive les mêmes refus nommés :
1. une session (`not_authenticated`, `42501`) ;
2. le droit d'écrire l'affaire (`app.can_write_card`, sinon `forbidden`, `42501`) ;
3. l'affaire vivante et dotée d'une adresse (`card_not_available`, `23514`) ;
4. l'identité, si elle est donnée, empruntable par la personne — les siennes, jamais celle du service
   (`identity_not_available`, `42501`) ;
5. la réponse, si elle est donnée, classée dans cette affaire (`reply_outside_card`, `23514`) ;
6. un destinataire au moins (`recipient_required`), un corps non vide (`body_required`), les bornes du §3.1 (`23514`) ;
7. **au plus 200 mails préparés en attente** par personne et par espace (`draft_limit_reached`, `23514`) : un assistant
   en boucle ne remplit pas la file sans fin. **[proposition]**

Le quota de l'identité **n'est pas consommé** : rien ne part. `origin` vaut `mcp` sous le jeton du connecteur, `web`
sinon. Rend l'identifiant du mail préparé.

### 3.4 `public.send_email_draft(...) returns uuid`

Arguments : `p_draft_id` et le **contenu final**, tel que le formulaire de relecture le porte au moment d'« Envoyer » :
`p_identity_id`, `p_to`, `p_subject`, `p_body_text`, `p_cc`, `p_bcc`, `p_attachments`. `SECURITY DEFINER`.
1. **Refusée sous le jeton du connecteur** (`review_required`, `42501`, §4) — avant toute lecture.
2. Le mail préparé verrouillé (`for update`), à la personne (`created_by = auth.uid()`), sinon `draft_not_found`
   en 404 par `app.raise_http_error(404, 'draft_not_found')` (`CRM-120`) — la même réponse qu'il soit absent ou à autrui.
3. Encore `pending`, sinon `draft_not_pending` (`23514`) : un mail écarté par l'assistant pendant la relecture ne part pas.
4. **L'envoi passe par `public.queue_outbound_email`**, sur l'affaire du mail préparé, avec le contenu final et la
   réponse du mail préparé : droit d'écrire, identité de la personne, signature, quota, pièces jointes, journal de
   l'affaire, tout est celui de l'envoi depuis l'écran. Un refus de cette fonction remonte tel quel, et le mail préparé
   reste `pending`.
5. `status = 'sent'`, `outbox_id`, `sent_at`. Rend l'identifiant de l'envoi en file.

**Ce qui part est ce que la personne a relu** : le contenu vient du formulaire, pas de la ligne. La ligne garde la
version préparée, que le fil de l'affaire ne montre pas ; l'envoi, lui, paraît dans le fil comme tout envoi.

### 3.5 `public.discard_email_draft(p_draft_id uuid) returns void`

Le mail préparé de la personne, encore `pending`, passe à `discarded` (`discarded_at`). Mêmes refus `draft_not_found` et
`draft_not_pending`. **Permise au connecteur** : écarter ne fait rien sortir (décision 829, question 1).

## 4. Aucun détournement — la base refuse l'envoi direct au connecteur

### 4.1 Reconnaître le jeton du connecteur

Le connecteur frappe son propre jeton interne pour chaque requête (`docs/SPEC-mcp.md` §5) : `iss` vaut
`p2enjoy-crm/mcp` et `canal` vaut `mcp`. L'assistant ne voit jamais ce jeton et ne peut pas le changer. Une fonction
interne, `app.via_connector() returns boolean`, rend vrai si **l'une ou l'autre** des deux revendications désigne le
connecteur (`auth.jwt()`). C'est la seule définition ; toutes les gardes l'appellent.

**Compromis nommé.** La garde distingue les jetons par ce que leur émetteur y écrit. Deux émetteurs existent, la fonction
`session` (`iss = p2enjoy-crm/session`) et le connecteur ; tous deux sont du code du dépôt, et tous deux détiennent
`JWT_SECRET`. Un troisième émetteur, s'il venait, devrait être rangé d'un côté ou de l'autre par cette fonction : la
spécification de cet émetteur le dira. La garde ne repose jamais sur un en-tête, une adresse ou un argument.

### 4.2 Les gardes

| Fonction | Sous le jeton du connecteur |
|---|---|
| `public.queue_outbound_email` | **refusée** : `review_required`, `42501` |
| `public.send_email_draft` | **refusée** : `review_required`, `42501` |
| `public.armer_sequence_relance` | **refusée** : `review_required`, `42501` — armer une séquence ferait partir des paliers sans relecture |
| `public.prepare_email`, `public.discard_email_draft` | permises |
| `public.interrompre_sequence_relance` | permise : interrompre ne fait rien sortir |

`authenticated` n'écrit ni `mail_outbox` ni `card_sequence_enrollments` (mesuré le 2026-11-03 : `SELECT` seul), et les
fonctions réservées à `service_role` (`reserver_envois`, `marquer_envoi_reussi`, `reprogrammer_envoi`…) restent hors de
portée de tout jeton de personne. **Aucune autre voie n'écrit dans la file d'envoi** : le recensement est rejoué par une
preuve pgTAP qui liste les fonctions exécutables par `authenticated` dont le corps nomme `mail_outbox` ou
`card_sequence_enrollments`, et échoue si une fonction nouvelle n'est pas rangée dans ce tableau.

### 4.3 Les relances automatiques

`app.executer_sequences_relance` tourne sous `pg_cron`, sans jeton de personne : `app.via_connector()` y vaut faux, et
les paliers partent comme avant. Le digest quotidien (`app.envoyer_digests`) de même. Rien ne change pour une séquence
déjà armée, y compris par l'écran au nom d'une personne qui emploie aussi le connecteur.

## 5. Le connecteur MCP — famille `messagerie`, aucune case nouvelle

*Décision 829, questions 1 et 2* : la fonctionnalité existe dans le connecteur, **dans la famille existante
`messagerie`**, dont elle partage les cases. Aucune migration de la liste fermée.

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle |
|---|---|---|---|
| `crm_mail_prepare` | `ajouter` (`aussi` : `affaires:consulter`) | `card:card_id` ; `autres` : `message:in_reply_to_message_id`, facultative | `public.prepare_email` |
| `crm_mail_draft_list` | `consulter` | `workspace` (argument), filtre facultatif `card_id` | `mail_drafts` |
| `crm_mail_draft_discard` | `supprimer` (`destructiveHint`) | `draft:draft_id` | `public.discard_email_draft` |

- **`crm_mail_prepare`** prend les arguments de l'ancien `crm_mail_send` (`card_id`, `to`, `cc`, `bcc`, `subject`, `body`,
  `from_address`, `in_reply_to_message_id`) et garde ses règles : identité désignée par son adresse, défaut de la
  personne, objet de réponse préfixé une fois, `reply_outside_card` vérifié avant l'appel. **Il n'a plus
  `destructiveHint`** : préparer ne sort rien du CRM. Il rend `draft_id`, `status: pending_review`, l'adresse d'expédition
  proposée, et **le lien de relecture** (`<SITE_URL>/inbox?brouillon=<draft_id>`), avec une phrase : « Ce mail n'est pas
  envoyé. Il attend votre relecture dans le CRM. »
- **`crm_mail_draft_list`** rend les mails préparés **en attente** de la personne dans l'espace, du plus ancien au plus
  récent, paginés (25, borné à 100) : `id`, `card_id`, le titre de l'affaire, `to`, `cc`, `subject`, un extrait du corps
  (280 caractères), `origin`, `created_at`. Les mails envoyés ou écartés n'y paraissent pas.
- **`crm_mail_draft_discard`** écarte un mail préparé en attente. **Genre d'ancre nouveau** : `draft` (`mail_drafts`, qui
  porte son `workspace_id`) ; la RLS fait d'un mail d'autrui un objet « introuvable ».
- **`crm_mail_send` est retiré**, sans alias : un outil nommé « send » qui n'enverrait pas tromperait l'assistant et la
  personne. Un client resté sur l'ancienne liste reçoit « outil inconnu » à son prochain appel.
- **Les consignes au modèle** (`INSTRUCTIONS`) : la ligne « confirmer avec la personne avant tout envoi » devient
  « un mail préparé n'est jamais envoyé par le connecteur ; donnez à la personne le lien de relecture ».
- **L'onglet « Connecteur MCP »** : la phrase de portée de `messagerie` devient « Lecture des fils ; préparer un email
  compte comme « ajouter », l'envoi se fait toujours dans le CRM ».
- **Refus nommés** ajoutés : `draft_limit_reached`, `draft_not_pending` ; `review_required` n'est jamais atteint par un
  outil du catalogue, et s'il l'était, il serait traduit « l'envoi se fait dans le CRM, après relecture ».

## 6. L'interface web

*Décision 829, question 4* : l'inbox **et** la fiche de l'affaire. Les règles de forme sont écrites au
`docs/DESIGN_SYSTEM.md` avant le code de l'écran (tranche T4).

### 6.1 L'inbox — l'entrée « Mails préparés »

- **Une troisième entrée de tête** dans le premier panneau, **avant** « Non classés » : « Mails préparés », avec le
  nombre des mails préparés en attente de la personne dans l'espace. **Elle n'apparaît que si ce nombre est non nul**
  **[proposition]** : une entrée vide en permanence chez qui n'emploie pas le connecteur serait du bruit.
- **La liste** (deuxième panneau) : une ligne par mail préparé, du plus ancien au plus récent — destinataires, objet,
  titre de l'affaire, « Préparé par l'assistant » (ou « Préparé dans le CRM » pour `origin = web`), et la date.
- **La relecture** (troisième panneau) : le **formulaire d'envoi habituel** de l'affaire, prérempli avec le mail préparé
  — identité, destinataires, copie, copie cachée, objet, corps, réponse ; on peut tout modifier et joindre des fichiers.
  Deux commandes : **« Envoyer »**, qui appelle `send_email_draft` avec le contenu du formulaire, et **« Écarter »**, qui
  appelle `discard_email_draft` après une confirmation. Après l'un ou l'autre, la ligne quitte la liste et l'annonce le
  dit (« Message envoyé », « Mail préparé écarté »).
- **L'adresse** `/inbox?brouillon=<id>` ouvre directement la relecture : c'est le lien que rend `crm_mail_prepare`. Un
  identifiant absent, écarté, envoyé ou à autrui ouvre l'état « Ce mail préparé n'est plus en attente », sans rien
  révéler de plus.
- Sous 1024 px, la pile du §5.4 du design system : entrée → liste → relecture.

### 6.2 La fiche de l'affaire

Dans la section des messages de la fiche, **au-dessus du fil**, un encadré par mail préparé en attente de la personne
pour cette affaire : « Mail préparé, à relire », destinataires et objet, et **« Relire et envoyer »**, qui ouvre la même
relecture que l'inbox. Les autres membres ne voient rien (§3.2).

### 6.3 Les états

Chargement, erreur avec reprise, file vide (l'entrée disparaît ; l'adresse directe d'un mail qui n'est plus en attente
rend l'état du §6.1), refus de l'envoi (le message du refus nommé, le formulaire gardé intact), lectrice (elle n'écrit
aucune affaire : `prepare_email` lui est refusé, elle n'a donc jamais de mail préparé).

## 7. Seed

**[proposition]** Deux mails préparés en attente pour l'administratrice, posés par `prepare_email` sous un jeton
`canal = mcp` frappé comme celui du connecteur — l'un sur « Plateforme de billetterie — Musée des Confluences », l'autre en
réponse à un message classé d'une autre affaire ; un troisième, écarté, par `discard_email_draft`. Aucun pour Camille ni
pour la lectrice. Le contrat du seed (`docs/SPEC-seed.md`) reçoit sa section et sa vérification.

## 8. Preuves exigées

- **pgTAP** : la table, ses politiques (la personne seule, l'administrateur ne lit pas le mail d'autrui), les trois
  fonctions et chacun de leurs refus ; `queue_outbound_email`, `send_email_draft` et `armer_sequence_relance` refusées
  sous des revendications `canal = mcp`, puis sous `iss = p2enjoy-crm/mcp` seule ; permises sous un jeton de session ; le
  recensement du §4.2 ; la purge d'une affaire emporte ses mails préparés.
- **pytest du connecteur** : déclaration des trois outils, absence de `crm_mail_send`, arguments, refus nommés, le lien
  de relecture.
- **Intégration du connecteur**, contre le vrai Keycloak et la vraie base : un mail préparé par un vrai client MCP est
  lu en base, **et rien n'est inscrit dans `mail_outbox`** ; puis, **en contournant le catalogue**, le jeton frappé par
  le connecteur appelle directement `rpc/queue_outbound_email`, `rpc/send_email_draft` et `rpc/armer_sequence_relance`
  par PostgREST : trois refus `review_required`, aucune ligne écrite (`CLAUDE.md` §10).
- **API** : sous le jeton de session de la personne, `send_email_draft` fait partir le mail (une ligne `mail_outbox`,
  puis l'envoi réel par `mail-sync` constaté dans le fil) ; sous celui d'une autre personne, 404 ; la lectrice ne
  prépare rien.
- **E2E** : l'entrée « Mails préparés », la relecture, une modification du corps, « Envoyer » et le message dans le fil
  de l'affaire avec le corps modifié ; « Écarter » ; l'encadré de la fiche ; l'adresse directe ; captures aux quatre
  paliers et au clavier seul.
- **Les relances** : une séquence armée par l'écran envoie toujours son palier sans mail préparé (preuve existante
  rejouée).

## 9. Découpage

| Tranche | Contenu |
|---|---|
| T1 | cette spécification, la décision 829, le backlog — committés avant le code |
| T2 | migration : table, politiques, `app.via_connector`, les trois fonctions, les gardes du §4.2 ; pgTAP ; `docs/SCHEMA.md` ; contrat de déploiement |
| T3 | connecteur : `crm_mail_prepare`, `crm_mail_draft_list`, `crm_mail_draft_discard`, genre d'ancre `draft`, retrait de `crm_mail_send`, consignes ; pytest et intégration (dont le contournement) ; `docs/SPEC-mcp.md` §9.2 *decies* ; manuel §33 |
| T4 | webapp : design system d'abord, l'entrée de l'inbox, la relecture, l'encadré de la fiche, l'adresse directe, l'onglet « Connecteur MCP » ; unitaires, API, E2E, captures ; manuel (inbox et fiche) |
| T5 | seed et sa vérification |
| T6 | livraison en production, sur instruction du responsable : migration, image `mcp`, webapp **dans la même fenêtre** — l'image `mcp` sans la migration appellerait une fonction absente, la migration sans l'image refuserait l'ancien `crm_mail_send` (`review_required`), ce qui est sûr mais casse l'outil |

## 10. Limites nommées

- L'anonymisation d'un contact (`docs/SPEC-audit.md` §7.2) ne touche ni `mail_outbox` ni `mail_drafts` : un mail préparé
  adressé à un contact anonymisé garde l'adresse, comme un envoi en file. À la relecture, la personne le voit.
- La garde reconnaît le connecteur par son jeton (§4.1) ; une personne qui écrirait elle-même un client PostgREST avec son
  jeton de session enverrait comme depuis l'écran — c'est l'envoi de l'écran, que la règle ne vise pas.
