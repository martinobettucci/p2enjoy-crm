# SPEC — L'espace courant : ce qu'il cloisonne, comment on en change, ce qui reste global

*Unité `CRM-161` (`docs/BACKLOG.md`). Écrite le 2026-11-21, avant le code, par la session 4891a451 (p2enjoy-crm-5f), à
partir des décisions **963**, **965** (qui révise la 963) et **967** (`docs/JOURNAL.md`).*

Ce document est l'index de l'unité : l'inventaire écran par écran et outil par outil (§4 à §6), la règle de la base (§7),
l'adresse et le menu des espaces (§8, §9), les pages globales (§10), le connecteur (§11), le seed (§12), les preuves (§13) et le
découpage en tranches (§14). Les chapitres propres à un sous-système le citent : `docs/SPEC-mail-subsystem.md` §35 (l'inbox d'un
espace), `docs/SPEC-webapp.md` §6.3 (ce que la coquille lit), `docs/SPEC-mcp.md` §9.2 (le catalogue), `docs/DAT.md` §3.

## 1. La demande et les arbitrages

**Verbatim du responsable** (2026-11-21) : « le inbox ne semble pas être contenu au workspace. en fait tout est contenu au
workspace. d'ailleurs on set un mail entrant par workspace donc lorsque je suis sur un workspace, je veux voir le mails reçue par
ce workspace et pareille pour toute autre ressource. »

**Décision 965** (révisant la 963) — l'espace courant ne cloisonne **que** :

1. **les tracks et les channels**, et ce qui s'y lit : la barre latérale, l'arborescence, la vue d'un track, d'un channel (son
   board kanban, sa liste), d'une affaire ouverte depuis eux, les coûts d'un track ;
2. **l'inbox** : ses mails, ses dossiers, ses compteurs, sa corbeille, son outbox ; **le menu des espaces affiche les non-lus de
   chaque espace** ;
3. **tout le reste est global** — l'accueil (« Tableau de bord »), Ma journée, Affaires figées, objectifs, temps, contacts et
   organisations, pilotage, coûts, rentabilité, reportings : **chaque ligne affiche son espace de provenance**, et un **filtre
   « Espace » facultatif** en isole un ; la cloche et la recherche globale restent multi-espaces, l'espace affiché ;
4. **le modèle ne change pas** : le coût du personnel est par personne **et** par espace ; temps, objectifs et coûts restent
   rattachés à leur espace ;
5. **le cloisonnement de (1) et (2) est appliqué en base** (§7) ; la RLS reste la règle d'accès.

**Décision 967** — changer d'espace :

- le **premier niveau du fil d'Ariane**, qui nomme déjà l'espace, devient le **menu des espaces** de la personne (§9) ;
- **l'espace est porté par l'adresse, onglet par onglet** ; **rien n'est stocké**, ni sur l'appareil ni en base : deux onglets
  travaillent en même temps sur deux espaces ;
- **l'espace est en tête du chemin** (`/<slug de l'espace>/…`) **pour les seules pages d'un espace** (§8.1) ; les pages globales
  gardent leur adresse ;
- **une adresse sans espace** (ancien lien, accueil après connexion) ouvre l'espace de la ressource quand elle en a un, sinon **le
  premier espace par nom** ;
- **un élément d'un autre espace**, ouvert depuis la cloche, la recherche ou un lien, **fait basculer l'onglet** sur son espace, et
  l'écran le dit par un message bref.

**Connecteur MCP** (décisions 963 et 965) : oui, vérifier et aligner ; **familles existantes** ; aucune case ni famille nouvelle
(§11).

## 2. Vocabulaire

- **Espace courant de l'onglet** : l'espace que porte l'adresse d'une page d'un espace ; sur une page globale, le dernier espace
  courant de l'onglet, tenu **en mémoire vive** par la coquille (un état React, perdu au rechargement, jamais écrit dans un
  stockage — `CLAUDE.md` §11) ; à défaut, le premier espace par nom.
- **Page d'un espace** : une page dont l'adresse commence par le slug d'un espace (§8.1).
- **Page globale** : une page qui lit tous les espaces de la personne et affiche l'espace de chaque ligne (§10).
- **Espace de provenance** : l'espace d'une ligne d'une page globale, nommé sur la ligne.

## 3. L'état de départ (inventaire du 2026-11-21, révision `22c1495c`)

- **Aucun sélecteur d'espace.** L'espace « courant » est le premier rendu par `lireWorkspaces` (`webapp/src/lib/workspaces.ts`),
  trié par nom : `AppShell.tsx` le tient dans `ContexteEspace`, `FilAriane.tsx` le nomme. Dix écrans le **recalculent** chacun de
  la même façon, sans lire le contexte : `Carnet`, `ListeOrganisations`, `Objectifs` (deux fois), `Pilotage` (par
  `donnees[0].workspace_id`), `ReglagesComptesMail`, `ReglagesIdentitesMail`, `ReglagesModelesEmails`, `ReglagesSequencesRelance`,
  `AdministrationCatalogue`, `AdministrationWorkflows`, `AdministrationArborescence`, `ImportCsv`.
- **La barre latérale lit les tracks de tous les espaces** (`lireTracks`, sans filtre d'espace).
- **L'adresse d'un track est ambiguë** : `/tracks/:slugTrack` ; or le slug n'est unique que **dans son espace**
  (`tracks_workspace_id_slug_key`). Le slug d'un espace, lui, est unique (`workspaces_slug_key`).
- **L'inbox lit tous les espaces** : `public.inbox_messages`, `inbox_arborescence` et `inbox_hidden_counts` (`0193`) ne prennent
  aucun espace ; `inbox_bulk_count`, `inbox_bulk_apply`, `inbox_bulk_unknown_senders` décrivent un dossier (`folder`) sans
  espace ; l'outbox (`mail_outbox`) et l'état de la messagerie sont lus sans filtre d'espace. Seule `trashed_messages` prend
  l'espace (`p_workspace_id`), et la webapp lui passe l'espace du contexte.
- **Le seed n'a qu'un espace** (« P2Enjoy SAS », `5eed0000-0000-4000-8000-000000000001`, trois membres) : rien ne montre le
  défaut.
- **Les liens sortants** : 33 adresses de track, de channel ou d'affaire sont composées dans la webapp (`lib/fil-ariane.ts`,
  `Board`, `RouteTrack`, `BlocRattachementsCard`, `ListeCards`, `lib/notifications.ts`, `lib/recherche.ts`, `lib/ma-journee.ts`,
  `lib/affaires-figees.ts`, `lib/couts-ecrans.ts`, `lib/contacts.ts`, …) ; la base en compose dans le résumé quotidien
  (`0133`, `{site}/tracks/…/cards/…`) ; le connecteur en rend une (`crm_mail_prepare` : `{origine}/inbox?brouillon=…`).
- **Le coût d'une adresse changée** : 50 routes (`webapp/src/app/chemins.ts`, `routes.tsx`), 725 `goto` dans 152 fichiers E2E, et
  les images du manuel des pages d'un espace.

## 4. Inventaire des pages — ce que chacune lit, avec quel espace

Légende de la colonne **Cible** : **E** page d'un espace (adresse préfixée, lectures cloisonnées) ; **G** page globale (tous les
espaces, espace de provenance affiché, filtre « Espace ») ; **—** hors du sujet (aucune donnée d'un espace).

| Page (adresse actuelle) | Écran | Ce qu'il lit aujourd'hui | Espace aujourd'hui | Cible |
|---|---|---|---|---|
| `/` Tableau de bord | `AccueilDemarrage`, `GuideDemarrage` | guide de démarrage de l'espace courant | contexte (premier) | **G** ; le guide reste celui de l'espace courant de l'onglet |
| `/inbox` | `RouteInbox`, `PanneauInbox`, `SeulementMoi`, `PastillesInbox`, `ActionsGroupeesInbox`, `TransfertInbox`, `OutboxInbox`, `CorbeilleInbox` | `inbox_messages`, `inbox_arborescence`, `inbox_hidden_counts`, `inbox_bulk_*`, `mail_outbox`, `mail_drafts`, `mail_message_transfers`, `trashed_messages` | aucun (sauf corbeille et pastilles) | **E** |
| `/tracks/:slugTrack[/:slugChannel]` | `RouteTrack`, `Board`, `TabBar` | le track par son slug, ses channels, ses affaires | aucun (slug ambigu) | **E** |
| `/tracks/:slugTrack/:slugChannel/liste` | `RouteTrack` (`ListeCards`) | les affaires du channel | aucun | **E** |
| `/tracks/:slugTrack/:slugChannel/cards/:idCard` | `RouteCard` | l'affaire | celui de l'affaire | **E** |
| `/tracks/:slugTrack/couts`, `…/couts/:idBudget` | `CoutsTrack`, `CoutsBudget` | budgets et coûts du track | aucun (slug ambigu) | **E** |
| `/reglages` et les 22 réglages `/reglages/…` | `IndexReglages`, `Reglages*`, `Administration*` | la configuration de l'espace | premier recalculé ou contexte | **E** |
| barre latérale | `Sidebar` | `tracks` | **tous** | **E** (l'espace courant de l'onglet) |
| `/ma-journee` | `MaJournee` | affaires et activités de la personne | tous | **G** |
| `/affaires-figees` | `AffairesFigees` | `cards_figees()` (rend `workspace_id`) | tous | **G** |
| `/objectifs`, `/objectifs/:idTableau` | `Objectifs`, `CanevasObjectifs` | `goal_boards` | **premier recalculé** | **G** (la liste) ; le canevas est celui d'un tableau, nommé avec son espace |
| `/temps` | `Temps`, `SaisieTemps`, `RapportTemps` | `saisies_temps`, `temps_valorise` | contexte (premier) | **G** |
| `/contacts`, `/contacts/:idContact` | `Carnet`, `FicheContact` | `contacts` | **premier recalculé** | **G** |
| `/contacts/organisations[/:id]` | `ListeOrganisations`, `FicheOrganisation` | `organization_list(p_workspace_id…)` | **premier recalculé** | **G** |
| `/pilotage` | `Pilotage` | `entonnoir_conversion()` (rend `workspace_id`), catalogue de nœuds | **premier** (`donnees[0].workspace_id`) | **G** |
| `/couts` | `CoutsWorkspace`, `CoutsASaisir`, `RecettesASaisir` | budgets, coûts, recettes | tous | **G** |
| `/rentabilite` | `Rentabilite` | `rentabilite_affaires()` (rend `workspace_id`) | tous | **G** |
| cloche, `Notifications` | `Notifications` | `notifications` (porte `workspace_id`) | tous | **G** (exception de la décision 963, maintenue) |
| recherche globale | `PaletteRecherche` | `recherche_globale()` (rend `workspace_id`), `search_hidden_mail_counts` | tous | **G** (exception maintenue) |
| `/demarrage` | `GuideDemarrage` | les étapes de l'espace courant | contexte | **E** par nature : le guide parle d'un espace ; il suit l'espace courant de l'onglet, son adresse ne change pas |
| `/aide[/:chapitre]` | `SommaireAide`, `ChapitreAide` | le manuel | — | **—** |
| `/plateforme/…` | `Plateforme*` | administration de la plateforme | ses propres espaces (`?espace=` de la fiche MCP) | **—** (inchangée) |

**Les créations sur une page globale** (« Nouveau contact », « Nouvelle organisation », « Nouveau tableau », l'import CSV, une
saisie de temps) écrivent dans **l'espace courant de l'onglet**, que le formulaire **nomme** (« Dans l'espace P2Enjoy SAS »). Une
saisie de temps porte sur un track, un channel ou une affaire : son espace est celui de sa cible.

## 5. Inventaire des lectures de la base

| Lecture | Aujourd'hui | Cible |
|---|---|---|
| `public.inbox_messages(p_card_id, p_only_me, p_label_ids, p_sender, p_limit)` | aucun espace | **`p_workspace_id` obligatoire** ; ne rend que cet espace |
| `public.inbox_hidden_counts(p_card_id, p_only_me, p_label_ids, p_sender, p_snoozed_shown)` | aucun espace | **`p_workspace_id` obligatoire** |
| `public.inbox_arborescence(p_only_me)` | aucun espace | **`p_workspace_id` obligatoire** |
| `public.inbox_bulk_count`, `inbox_bulk_apply`, `inbox_bulk_unknown_senders` (`p_scope jsonb`) | un dossier sans espace ; les fils nommés portent déjà leur `workspace_id` | **`workspace_id` obligatoire dans la portée** ; un fil nommé d'un autre espace est refusé |
| `public.trashed_messages(p_workspace_id)` | déjà cloisonnée | inchangée |
| `mail_outbox` (outbox, état de la messagerie), `mail_drafts`, `mail_message_transfers` | tables lues sans filtre d'espace | filtre `workspace_id=eq.<espace>` (§7.2) |
| **nouvelle** `public.inbox_unread_by_workspace(p_only_me)` | — | un compte de non-lus **par espace** de la personne, pour le menu (§9) ; multi-espaces par nature |
| `tracks` (barre latérale, `lireTracks`), `channels`, résolution d'un track par son slug | aucun espace | filtre `workspace_id=eq.<espace>` ; un track se résout par **(espace, slug)** |
| `search_hidden_mail_counts(p_terme)` | tous | inchangée (la recherche est globale) |
| `cards_figees()`, `entonnoir_conversion()`, `rentabilite_affaires(…)`, `recherche_globale(…)` | tous, `workspace_id` rendu | inchangées (pages globales) |
| `temps_valorise(…)` | tous, sans `workspace_id` | l'espace de chaque ligne, par sa cible (track, channel, affaire) — à trancher en tranche T3 : colonne ajoutée ou jointure côté écran |
| `organization_list(p_workspace_id, …)` | un espace | **tous les espaces** quand `p_workspace_id` est nul, `workspace_id` rendu (T3) |

## 6. Inventaire du connecteur MCP

Le connecteur est **déjà cloisonné par outil** : chaque outil se déclare avec une ancre (`Declaration(espace=…)`) — un espace
nommé (`workspace:workspace`), ou un objet qui porte le sien (`card:card_id`, `message:message_id`, `track:track_id`, …) — et le
contrôle de la matrice se fait dans cet espace. Sur les 135 outils du catalogue :

- **aucun outil ne liste l'inbox** (pas d'équivalent de `inbox_messages`) : rien à aligner pour (2), sinon
  `crm_mail_outbox_list`, `crm_mail_draft_list` et `crm_mail_trash_list`, qui prennent déjà l'espace ;
- **tracks et channels** : `crm_track_list` et `crm_channel_list` prennent `workspace` ; les autres outils passent par un objet ;
- **multi-espaces par nature** : `crm_workspace_list`, `crm_search` (qui rend le `workspace_id` de chaque résultat) ;
- **outils des pages globales** (`crm_contact_list`, `crm_organization_list`, `crm_goal_board_list`, `crm_time_report`,
  `crm_costs_to_enter`, `crm_revenues_to_enter`, `crm_profitability_report`, …) : ils prennent un espace ; la décision 965 les
  laisse ainsi (« les autres peuvent rester multi-espaces en rendant l'espace de chaque élément ») ;
- **liens rendus** : `crm_mail_prepare` rend `{origine}/inbox?brouillon=…` ; il deviendra `{origine}/<slug>/inbox?brouillon=…`
  (T4).

L'audit outil par outil — l'ancre, l'espace de chaque élément rendu, le lien rendu — est consigné à la tranche T4 dans
`docs/SPEC-mcp.md` §9.2 ; le résultat attendu est **aucune famille, aucune case, aucun outil nouveau**.

## 7. La règle de la base

### 7.1 Les fonctions de l'inbox prennent l'espace

- `inbox_messages`, `inbox_hidden_counts`, `inbox_arborescence` reçoivent **`p_workspace_id uuid`, sans valeur par défaut** ; nul,
  la fonction lève **`workspace_required`** (`22023`). Elles ne rendent **que** des messages de cet espace (`m.workspace_id =
  p_workspace_id`), en plus de la RLS, qui reste la règle d'accès : un espace dont la personne n'est pas membre rend zéro ligne,
  jamais une erreur qui le révélerait.
- L'**ancienne signature est supprimée** dans la même migration (`drop function`) : PostgREST ne doit pas résoudre un appel sans
  espace vers elle.
- La portée des actions groupées (`app.inbox_scope_messages`) exige `workspace_id` ; un fil nommé hors de cet espace est refusé
  (**`thread_other_workspace`**, `22023`) plutôt qu'ignoré, pour qu'un écran périmé ne croie pas avoir agi.
- `inbox_unread_by_workspace(p_only_me boolean default false)` rend `(workspace_id uuid, unread_count integer)` pour chaque
  espace de la personne, avec **les mêmes règles de visibilité que `inbox_arborescence`** (pastilles cachées, « Seulement moi ») ;
  un espace sans non-lu rend `0`, pas une absence.

### 7.2 Les lectures de table

Une lecture de table (`tracks`, `channels`, `mail_outbox`, `mail_drafts`, `mail_message_transfers`) porte le filtre
`workspace_id=eq.<espace>` : c'est la base qui l'applique, et une requête directe le prouve (§13). Aucune politique RLS n'est
redéfinie (décision 965 : la RLS reste la règle d'accès).

### 7.3 Ce que la migration ne touche pas

`app.card_par_adresse`, le classement d'un mail entrant (`0143`, `0190`), les écritures de `cards` et de `mail_messages` :
`CRM-162` (session f9) les redéfinira à partir des définitions de `CRM-161` (accord du 2026-11-21 ; `CRM-161` migre en premier).

## 8. L'adresse

### 8.1 Les pages d'un espace

| Avant | Après |
|---|---|
| `/inbox` | `/:slugEspace/inbox` |
| `/tracks/:slugTrack`, `/tracks/:slugTrack/:slugChannel` | `/:slugEspace/tracks/:slugTrack`, `/:slugEspace/tracks/:slugTrack/:slugChannel` |
| `/tracks/:slugTrack/:slugChannel/liste` | `/:slugEspace/tracks/:slugTrack/:slugChannel/liste` |
| `/tracks/:slugTrack/:slugChannel/cards/:idCard` | `/:slugEspace/tracks/:slugTrack/:slugChannel/cards/:idCard` |
| `/tracks/:slugTrack/couts[/:idBudget]` | `/:slugEspace/tracks/:slugTrack/couts[/:idBudget]` |
| `/reglages` et `/reglages/…` | `/:slugEspace/reglages` et `/:slugEspace/reglages/…` |

Les adresses sont composées **par un seul module** (`webapp/src/app/chemins.ts`), qui reçoit le slug de l'espace : aucune adresse
d'une page d'un espace n'est plus écrite à la main dans un écran.

Les paramètres d'adresse existants (`?message=`, `?brouillon=`, `#commentaire-…`, les filtres) sont conservés tels quels.

### 8.2 Les anciennes adresses

Une adresse sans slug d'espace est **redirigée** (`replace`, sans entrée d'historique) :

- **vers l'espace de la ressource** quand elle en nomme une : une affaire (`…/cards/:idCard` : l'espace de l'affaire), un message
  (`/inbox?message=…` : l'espace du message), un brouillon (`?brouillon=`) ;
- **sinon vers le premier espace par nom** qui porte la ressource (un track par son slug : le premier espace par nom qui en a
  un), ou le premier espace par nom.

Une ressource introuvable dans tous les espaces garde l'état d'erreur de l'écran (introuvable), sans redirection.

**Une ressource qui a changé d'espace** (un track déplacé par `CRM-162`) : une adresse **préfixée** de l'espace de départ
(`/<départ>/tracks/<track>`) ne nomme plus rien. Une **affaire** se retrouve par son identifiant, présent dans l'adresse : elle
est redirigée vers son espace et son rattachement actuels. Un **track** ou un **channel** ne porte qu'un slug, unique dans son
seul espace : sa redirection demande la trace du déplacement que `CRM-162` tient. Accord avec la session f9 (2026-11-21) :
`CRM-162` fournit une lecture qui résout `(slug de l'espace de départ, slug du track)` vers l'adresse actuelle ; la route d'un
track l'appelle quand le track est introuvable dans l'espace de l'adresse, avant l'état « introuvable ».

### 8.3 Une adresse d'un espace dont la personne n'est pas membre

Le slug est résolu parmi **les espaces lus** (`lireWorkspaces`, sous la RLS) : un slug inconnu rend l'état « Espace introuvable »,
avec un lien vers le premier espace par nom ; il ne dit jamais si l'espace existe.

### 8.4 La bascule

Un lien vers une page d'un espace **autre que l'espace courant de l'onglet** (cloche, recherche, page globale, lien collé) ouvre
cette page dans son espace : l'onglet bascule, et un message bref, annoncé (`role="status"`), dit « Vous êtes passé dans l'espace
X. ». Le menu des espaces le reflète.

## 9. Le menu des espaces

- Le **premier niveau du fil d'Ariane** (`FilAriane.tsx`, `data-testid="workspace-courant"`) devient un **bouton de menu** quand la
  personne a **au moins deux espaces** ; avec un seul, il reste le texte d'aujourd'hui.
- Le menu liste les espaces **par nom**, l'espace courant marqué (`aria-current`), chacun avec son **compte de non-lus de l'inbox**
  (`inbox_unread_by_workspace`), affiché seulement s'il est non nul ; le bouton porte une pastille si **un autre espace** a des
  non-lus.
- Choisir un espace ouvre **la même page dans cet espace** quand elle existe (`/a/inbox` → `/b/inbox`, `/a/reglages/etiquettes` →
  `/b/reglages/etiquettes`) ; une page d'un objet (un track, une affaire) ouvre l'**inbox** de l'espace choisi ; sur une page
  globale, l'onglet change d'espace courant sans changer de page.
- Clavier : `Entrée` ou `Espace` ouvre, flèches, `Échap` referme et rend le focus au bouton (`docs/DESIGN_SYSTEM.md`, section
  écrite en tranche T2 après la lecture intégrale du design system).

## 10. Les pages globales

- **Chaque ligne nomme son espace de provenance** — une colonne « Espace » dans un tableau, une mention sous le titre dans une
  liste ou une carte — **dès que la personne a au moins deux espaces** ; avec un seul, rien ne change.
- **Un filtre « Espace » facultatif**, multi-sélection, isole un ou plusieurs espaces ; il vit dans l'adresse de la page
  (`?espaces=<slug>,<slug>`), comme les autres filtres ; vide, la page montre tous les espaces.
- **Les montants ne se somment jamais entre devises** — règle existante, inchangée ; un total multi-espaces reste par devise.
- **Les liens d'une ligne** mènent à la page de sa ressource, **dans son espace** (§8.4).
- Les écrans qui **lisaient le premier espace seul** (`Objectifs`, `Carnet`, `ListeOrganisations`, `Pilotage`, `Temps`) passent à
  tous les espaces ; c'est un **changement visible** pour un membre de plusieurs espaces, consigné au manuel et au changelog.

## 11. Le connecteur

- **Aucune famille, aucune case, aucun outil nouveau** (décision 965).
- Les outils de l'inbox, des tracks et des channels **agissent dans un espace** : c'est déjà le cas (§6) ; l'audit le consigne
  outil par outil.
- Les liens rendus vers la webapp prennent le slug de l'espace (`crm_mail_prepare`).
- Les outils multi-espaces (`crm_workspace_list`, `crm_search`) restent multi-espaces ; chaque élément rendu porte son espace.

## 12. Le seed

Une section nouvelle de `docs/SPEC-seed.md` (écrite en tranche T2, avec le premier écran qui en a besoin) :

- un **second espace**, « Studio Lumen » (`studio-lumen`, `5eed0000-0000-4000-8000-000000002001`), trié **après**
  « P2Enjoy SAS » : l'espace par défaut reste « P2Enjoy SAS », et les preuves existantes ne changent pas d'espace. **Accord
  avec la session f9 (2026-11-21)** : `CRM-162` le **crée** dans son §54 du seed (`docs/SPEC-seed.md`), avec
  `admin@p2enjoy.test` administratrice, et y pose ses homonymes ; `CRM-161` l'**enrichit** dans un §55, sans le recréer ;
- **un compte membre des deux espaces**, administrateur dans les deux (le cas du responsable) ;
- dans « Studio Lumen » : **un track, un channel, une affaire**, un mail **non classé** et un mail **dans l'affaire**, déposés par
  le vrai chemin (dépôt IMAP dans la boîte de l'espace, puis la vraie relève de `mail-sync`, patron du §49 et du §53), dont au
  moins un **non lu** ;
- un **contact**, une **organisation**, un **tableau d'objectifs** et une **saisie de temps** dans « Studio Lumen », pour que
  chaque page globale montre deux espaces de provenance.

La tranche T1 ne touche pas le seed : ses preuves de base posent leurs propres espaces (pgTAP en transaction, API par la clé de
service, retirées à la fin).

## 13. Les preuves

| Niveau | Ce qui est prouvé |
|---|---|
| **pgTAP** (T1) | un membre de deux espaces : `inbox_messages`, `inbox_hidden_counts`, `inbox_arborescence` d'un espace ne rendent **aucun** message de l'autre (**rouge** sur les définitions de `0193`, puis vert) ; `p_workspace_id` nul → `workspace_required` ; un espace non membre → zéro ligne ; la portée des actions groupées refuse un fil d'un autre espace ; `inbox_unread_by_workspace` compte par espace, `0` compris, avec les pastilles cachées et « Seulement moi » |
| **API par requête directe** (T1) | les mêmes, par PostgREST avec le vrai jeton d'un membre de deux espaces : `rpc/inbox_messages` sans espace est refusé, avec un espace ne rend que lui ; l'ancienne signature n'existe plus |
| **Unitaires** (T1 à T3) | la composition des adresses (§8.1), la résolution des anciennes adresses (§8.2), le menu (§9), la colonne et le filtre « Espace » (§10) |
| **E2E** (T2, T3), souris et clavier | sur le compte membre des deux espaces : changer d'espace par le menu, les non-lus de l'autre espace, l'inbox et la barre latérale de chaque espace, deux onglets sur deux espaces, une ancienne adresse redirigée, la bascule depuis la cloche et la recherche, chaque page globale avec son espace de provenance et son filtre ; un compte d'un seul espace ne voit **aucun** menu |
| **Intégration MCP** (T4) | `crm_mail_prepare` rend le lien préfixé ; un outil de l'inbox ne rend que son espace |
| **Captures** | le menu ouvert, l'inbox de chaque espace, une page globale à deux espaces, aux quatre paliers |

La campagne complète revient à la session de livraison (décision 830). Chaque tranche laisse **verte**, sur son périmètre, la
suite qu'elle touche : les `goto` des E2E et les images du manuel d'une adresse changée sont révisés **dans la tranche qui la
change** (demande de la session de livraison, 2026-11-21).

## 14. Les tranches

- **T1 — La base : l'inbox d'un espace.** Migration (§7.1, §7.2) ; la webapp passe l'espace du contexte (toujours le premier par
  nom à ce stade) à chaque lecture de l'inbox : **aucun changement visible**. pgTAP et API (§13). `docs/SPEC-mail-subsystem.md`
  §35, `docs/DAT.md`, contrat. Connecteur : aucun appel de l'inbox à aligner (§6).
- **T2 — L'adresse et le menu des espaces.** Les pages d'un espace sous `/:slugEspace/` (§8), les anciennes adresses redirigées,
  la bascule, le menu et ses non-lus (§9), la barre latérale et les réglages sur l'espace de l'adresse, `chemins.ts` seul
  compositeur ; le seed (§12) ; le design system (lecture intégrale d'abord) ; les `goto` des E2E et les images du manuel des
  pages d'un espace ; les liens du résumé quotidien (`0133`, migration si la composition reste en base).
- **T3 — Les pages globales.** Espace de provenance et filtre « Espace » (§10) sur l'accueil, Ma journée, Affaires figées,
  objectifs, temps, contacts et organisations, pilotage, coûts et recettes à saisir, rentabilité, cloche, recherche ; les écrans
  qui lisaient le premier espace passent à tous ; les créations nomment l'espace courant de l'onglet. Peut se découper par
  écran.
- **T4 — Le connecteur.** L'audit outil par outil dans `docs/SPEC-mcp.md` §9.2 ; le lien de `crm_mail_prepare` ; intégration.
- **T5 — Le manuel et la livraison.** Le chapitre « Changer d'espace » (`docs/MANUAL_PLAN.md`), le contrat
  (`docs/PROD_MIGRATIONS.md`), la remise à la session de livraison.

Chaque tranche est spécifiée en détail (ses textes, ses refus, ses preuves nommées) **avant son code**, dans les chapitres cités,
et signalée prête à la session de livraison.

## 15. La tranche T2 en détail

*Écrit le 2026-11-21, avant le code de T2, après la lecture ciblée du design system (décision 970 : §1 à §4, §5.43,
§5.62, §6 à §12) et de la coquille (`AppShell.tsx`, `FilAriane.tsx`, `Sidebar.tsx`, `RouteTrack.tsx`, `chemins.ts`,
`routes.tsx`). Livrée avec T1 en un seul lot (accord de la session de livraison, 2026-11-21) ; T3 à T5 forment le second lot.*

T2 se découpe en deux sous-tranches, chacune laissant verte la suite de son périmètre :

- **T2.a — l'adresse** : l'espace en tête du chemin, l'espace courant tiré de l'adresse, les anciennes adresses redirigées,
  la barre latérale et les écrans d'un espace sur cet espace, les liens composés par un seul module, les slugs réservés, et
  les `goto` des E2E révisés. **Aucun changement visible** pour une personne d'un seul espace, hors l'adresse.
- **T2.b — le menu des espaces** : le menu et ses non-lus, la bascule annoncée, le seed (§55), le design system, les E2E et
  captures sur un compte de deux espaces, le manuel.

### 15.1 Les routes (T2.a)

- Les routes des pages d'un espace (§8.1) sont déclarées sous **`/:slugEspace/`** : `inbox`, `tracks/:slugTrack`,
  `tracks/:slugTrack/:slugChannel`, `…/liste`, `…/cards/:idCard`, `tracks/:slugTrack/couts`, `…/couts/:idBudget`, `reglages`
  et chacune des routes `reglages/…`. Les routes globales et la plateforme ne changent pas.
- **Les slugs réservés.** Un espace dont le slug serait un premier segment d'une route globale (`aide`, `plateforme`,
  `contacts`, `objectifs`, `couts`, `pilotage`, `temps`, `rentabilite`, `ma-journee`, `affaires-figees`, `demarrage`,
  `connexion`, `auth`, et les anciens premiers segments `inbox`, `tracks`, `reglages`) rendrait une adresse ambiguë. Une
  migration ajoute à `workspaces` la contrainte **`workspaces_slug_not_reserved`** ; la création d'un espace sur
  Plateforme ▸ Espaces dit le refus en clair (« Ce nom d'adresse est réservé par l'application. Choisissez-en un autre. »).
  Le seed (`p2enjoy`) et « Studio Lumen » (`studio-lumen`) n'en sont pas. *Choix de la spécification, validé par le responsable
  (décision 971).*
- **Le slug de l'adresse** est résolu parmi les espaces lus (`lireWorkspaces`) : inconnu, l'écran rend « Espace
  introuvable » (`data-testid="espace-introuvable"`) et un lien vers le premier espace par nom (§8.3).

### 15.2 L'espace courant de l'onglet (T2.a)

- `ContexteEspace` gagne **`slugEspace`** et **`espaces`** (la liste lue, id, nom, slug), pour que chaque écran compose ses
  liens sans relire.
- **Sur une page d'un espace**, l'espace courant est celui de l'adresse.
- **Un slug inconnu** (§8.3) : la barre latérale et le fil montrent le premier espace par nom — celui où mène le lien
  proposé —, la zone principale dit « Espace introuvable » (*précisé au code*).
- **Sur une page globale**, c'est le dernier espace courant de l'onglet, tenu par un **module en mémoire vive**
  (`webapp/src/lib/espace-onglet.ts`) : une variable du module, vivante tant que la page n'est pas rechargée, propre à
  l'onglet par nature (chaque onglet a son propre contexte JavaScript), jamais écrite dans un stockage (`CLAUDE.md` §11) ;
  à défaut, le premier espace par nom.
- **Les écrans qui recalculaient le premier espace** (§3 : `Carnet`, `ListeOrganisations`, `Objectifs`, `Pilotage`,
  `ImportCsv`, `ReglagesComptesMail`, `ReglagesIdentitesMail`, `ReglagesModelesEmails`, `ReglagesSequencesRelance`,
  `AdministrationCatalogue`, `AdministrationWorkflows`, `AdministrationArborescence`) lisent **l'espace du contexte**. Pour les
  pages globales parmi eux (`Carnet`, `ListeOrganisations`, `Objectifs`, `Pilotage`), c'est **l'état intermédiaire entre
  les deux lots** : elles suivent l'espace courant de l'onglet jusqu'à ce que T3 les rende globales. Sans effet en
  production tant qu'elle n'a qu'un espace (accord de la session de livraison) ; consigné au contrat de T2.
  *Écart trouvé par la campagne du lot (2026-11-21, décision 976)* : `ListeOrganisations` et `Objectifs` le tenaient ;
  `Carnet` lisait sa **liste** sans espace, et `Pilotage` additionnait sous la portée « espace » les lignes de **tous** les
  espaces (deux « Prospection », les affaires sans montant de « Studio Lumen » comptées). Les deux lisent désormais l'espace
  courant de l'onglet — la liste du carnet par `lireContactsDuCarnet(client, espace)`, les lignes de l'entonnoir restreintes à
  cet espace avant toute portée. Preuves : `e2e/ui/contacts.spec.ts` et `e2e/ui/pilotage.spec.ts`, rouges avant, leurs
  assertions inchangées ; un unitaire de `restreindre` à la portée d'espace.
- **La barre latérale** ne liste que les tracks de l'espace courant (`lireTracks` filtré par `workspace_id`), et ses
  entrées d'espace (Inbox, Réglages) mènent dans cet espace.

### 15.3 Les liens (T2.a)

- `webapp/src/app/chemins.ts` compose **toutes** les adresses des pages d'un espace à partir du slug de l'espace :
  `cheminInbox(slug)`, `cheminTrack(slug, track)`, `cheminChannel(slug, track, channel)`, `cheminAffaire(slug, track,
  channel, id)`, `cheminCoutsTrack(…)`, `cheminReglages(slug, sous)`. Les 33 compositions recensées (§3) passent par lui.
- **Une ligne d'une page globale** (Ma journée, Affaires figées, la cloche, la recherche, un contact, une organisation, le
  pilotage, la rentabilité) compose son lien avec **le slug de l'espace de sa ressource**, lu dans `ContexteEspace.espaces`
  par son `workspace_id`. Un `workspace_id` absent de la liste (une donnée lue avant un changement de droits) rend la ligne
  sans lien, jamais un lien vers un autre espace.
- *Précisé au code de T2.a, le 2026-11-21* : les écrans d'une page d'un espace importent `LienEspace` et
  `useNaviguerEspace` (`webapp/src/app/LienEspace.tsx`) à la place de `Link` et de `useNavigate` : un chemin d'espace y est
  mis dans l'espace courant, un chemin global reste tel quel. **Les lignes des pages globales** (la cloche, la recherche, Ma
  journée, Affaires figées, la rentabilité, un contact, une organisation, les coûts, les objectifs) **gardent en T2.a
  l'ancienne adresse** : la redirection (§15.4) la mène dans l'espace de la ressource — par l'identifiant de l'affaire ou du
  message —, ce qui est la bascule voulue (§8.4) ; T3 les composera directement avec le slug de leur ressource.
- Les liens sortants : le résumé quotidien (`0133`) compose `{site}/tracks/…/cards/…` en base ; il est **laissé tel quel**
  en T2 — la redirection des anciennes adresses (§8.2) le sert — et repris avec T3 ; le connecteur avec T4.

### 15.4 Les anciennes adresses (T2.a)

Une route d'**ancienne adresse** par famille, qui rend un écran de résolution bref (squelette), puis remplace l'adresse :

| Ancienne adresse | Résolution |
|---|---|
| `/inbox[?message=…]` | l'espace du message (`mail_messages.workspace_id`) s'il est lisible ; sinon l'espace courant de l'onglet |
| `/inbox?brouillon=…` | l'espace du mail préparé (`mail_drafts.workspace_id`) |
| `/tracks/:t[/:c[/liste]]`, `/tracks/:t/couts[/:b]` | le premier espace par nom dont un track lisible a le slug `:t` ; sinon l'espace courant (l'écran dira « introuvable ») |
| `/tracks/:t/:c/cards/:id` | l'espace de l'affaire `:id` (`cards.workspace_id`) |
| `/reglages[/…]` | l'espace courant de l'onglet |

Paramètres et ancre sont recopiés. La redirection est `replace` : « Précédent » ne ramène pas à l'ancienne adresse.

**Un track déplacé** (`CRM-162`) : la route d'un track introuvable dans l'espace de l'adresse appelle
`public.track_current_address(p_workspace_slug, p_track_slug)` **si elle existe** au moment du code (§8.2, accord avec la
session f9) ; sinon la session f9 ajoute l'appel.

### 15.4 bis Ce que T2.a ne fait pas encore : les listes des réglages

*Constaté au code de T2.a, le 2026-11-21.* Les écrans de réglages **créent** désormais dans l'espace de l'adresse, mais
plusieurs **lisent** leurs listes sans filtre d'espace (`lireComptesEntrants`, `lireIdentitesSortantes`, `lireModelesEmails`,
`lireSequences`, `lireCatalogueAdministrable`, `lireTracksAdministrables`, …) : sous la RLS, un membre de deux espaces y verrait
les lignes des deux. Défaut **antérieur** à `CRM-161`, sans effet tant qu'il n'y a qu'un espace. Il est repris par une
sous-tranche **T2.c — les réglages ne lisent que l'espace de l'adresse**, avant T2.b (qui pose le second espace du seed) :
chaque lecture de liste d'un réglage porte `workspace_id=eq.` ; preuve unitaire par écran et un E2E sur l'espace jetable.

**Le détail de T2.c** (*écrit le 2026-11-21, avant son code*). Les lectures **de premier niveau** d'un écran de réglages — celles
qui listent des objets de l'espace, et non les enfants d'un objet déjà désigné par son identifiant — prennent l'espace de
l'écran (`idEspaceParmi`, §15.2) et portent `workspace_id=eq.` :

| Module | Lecture | Écran |
|---|---|---|
| `etiquettes` | `lireEtiquettes` (option `idWorkspace`) | Réglages ▸ Étiquettes |
| `administration-arborescence` | `lireTracksAdministrables` | Réglages ▸ Arborescence |
| `administration-workflows` | `lireWorkflowsAdministrables`, `lireCatalogueActif`, `lireTracksAffectables` | Réglages ▸ Workflows |
| `assistant-ia` | `lireSuggestionsEnRevue` (*ajoutée par la décision 974 : omise du tableau, trouvée sur la capture de la preuve*) | Réglages ▸ Workflows |
| `administration-catalogue` | `lireCatalogueAdministrable` | Réglages ▸ Catalogue |
| `mail-comptes`, `mail-identites` | `lireComptesEntrants`, `lireIdentitesSortantes` | Réglages ▸ Boîtes, ▸ Identités |
| `modeles-affaires` | `lireModeles` (option `idWorkspace`) | Réglages ▸ Modèles d'affaires |
| `modeles-emails` | `lireModelesEmails` | Réglages ▸ Modèles d'emails |
| `sequences-relance` | `lireSequences` | Réglages ▸ Séquences de relance |
| `corbeille` | `lireCorbeille` | Réglages ▸ Corbeille |

**Déjà filtrées** : catégories d'organisations, champs communs, coût du personnel, expéditeurs bloqués, journal d'audit,
membres, pastilles des mails, prompts du connecteur, webhooks, consentement au résumé. **Hors de T2.c** : les préférences de
notification (personnelles), le catalogue des pastilles lu par identifiant (`lireCataloguePastillesMail`, une table de
correspondance), les lectures d'enfants par l'identifiant du parent.

**Preuves** : un test unitaire par lecture (le filtre `workspace_id` est émis) ; un E2E (`e2e/ui/reglages-espace.spec.ts`) qui
pose sous la clé de service un espace jetable dont Camille est administratrice, avec une étiquette et un track, et vérifie
que Réglages ▸ Étiquettes et ▸ Arborescence de chaque espace ne montrent que les siens — **rouge avant**, la liste mêlant les
deux espaces.

**Le défaut que la campagne du lot a trouvé** (*2026-11-21, décision 974 ; écrit avant son code*). Les lectures de T2.c
portent bien `workspace_id=eq.`, mais **la coquille rendait le contenu de la page pendant qu'elle lisait les espaces**
(`ZonePrincipale` : « `chargement` comme `pret` laissent la route rendre son propre contenu »). Un écran de réglages se
montait donc d'abord avec `idWorkspace` **nul**, et son option `idWorkspace ?? undefined` lisait **sans filtre** : sous la
RLS, les deux espaces de Camille. Les écrans qui relisent à l'arrivée de l'espace ne montraient qu'un éclair ; ceux dont
l'effet ne dépend pas de l'espace ne relisaient jamais — Réglages ▸ Workflows choisissait d'office le défaut de « Studio
Lumen » (« Cycle commercial ») sur `/p2enjoy/reglages/workflows`, et ses blocs suivants (étapes, suggestions de l'IA)
suivaient ce choix.

**La règle** : **la coquille ne monte le contenu de la page qu'une fois les espaces lus.** Pendant la lecture des espaces, la
zone principale rend un **squelette** (`SkeletonListe`, nom accessible « Chargement en cours » — design system §5.8 : des
squelettes, jamais un écran blanc ni un spinner plein écran) ; la barre latérale et l'en-tête gardent leurs propres
squelettes. Une fois les espaces lus, la page se monte avec l'espace déjà connu : aucune de ses lectures ne part sans lui. La
coquille restant montée d'une page à l'autre (INC-254), l'attente n'a lieu qu'à la première page de l'onglet. Un échec de
lecture des espaces reste dit comme avant (refus ou erreur avec reprise), et « Espace introuvable » aussi.

**Preuves** : un unitaire de la coquille (pendant la lecture des espaces, le contenu n'est pas monté et le squelette est rendu ;
après, le contenu se monte une fois, avec l'espace) ; un E2E ajouté à `e2e/ui/reglages-espace.spec.ts`, **rouge avant** :
l'espace jetable porte un workflow par défaut dont le nom le distingue, et Réglages ▸ Workflows de l'espace du seed montre le
défaut du seed, jamais celui de la sonde ; puis les specs d'écran que le défaut explique (`workflow-entete-changement`,
`description-etapes`, `assistant-ia-modification`, `tester-connexion`).

**Les sélecteurs liés à un espace** (*2026-11-21, décision 975 ; écrit avant son code*). La même campagne a trouvé un second
défaut de la même famille : **une liste de choix qui sert un objet d'un espace lit le carnet entier de la personne**. Sur une
affaire du seed, le formulaire offrait les contacts de « Studio Lumen », que la base refuse ensuite à l'écriture (« ne désigne
aucun contact de ce workspace », migration 47). **La règle** : le carnet est global (décision 965), mais **un choix fait pour
un objet d'un espace ne propose que les lignes de cet espace**. `lireContactsDuCarnet` prend un espace facultatif, et le
reçoivent :

| Écran | Lecture | Espace |
|---|---|---|
| Formulaire d'une affaire (`FormulaireCard`) | `lireContactsDuCarnet` | celui de l'affaire |
| Bloc « Contacts » d'une affaire (`BlocContactsCard`) | `lireContactsDuCarnet` | celui de l'affaire |
| Réglages ▸ Modèles d'emails, l'aperçu | `lireContactsDuCarnet`, `lireAffairesPrevisualisation`, `lireIdentitesSortantes` | celui de l'écran |
| Temps ▸ Saisie, les lignes de la grille (*ajoutée le 2026-11-21, vue sur une image du manuel*) | `lireArbreTemps` | celui des saisies (l'espace courant) — clés composites `(track_id, workspace_id)` |
| Bloc « Relance automatique » d'une affaire (*idem*) | `lireSequences`, `lireIdentitesDisponibles` | celui de l'affaire |

Le carnet (`Carnet`, page globale) garde sa lecture entière. **Limite levée par T3.a** (§16.4, le 2026-11-24) : le formulaire d'envoi lisait les identités
d'expédition de tous les espaces de la personne ; il les lit désormais dans l'espace de l'affaire, lu avec son domaine. **Preuves** : un unitaire par lecture (le filtre émis quand
l'espace est donné, aucun quand il est omis) ; `e2e/ui/formulaire-selecteurs.spec.ts` rouge avant (quatorze options sur une
affaire du seed, deux de Lumen), vert après (douze) ; le bloc « Contacts » et l'aperçu, en unitaires d'écran.

### 15.5 Les E2E de T2.a

- Les `goto` vers une page d'un espace (436, dans 117 fichiers de `e2e/ui`, `e2e/manuel`, `e2e/mail`) sont révisés vers
  `/p2enjoy/…` (`ESPACE_SEED`, `e2e/espace.ts`), par un remplacement mécanique relu, **dans le même commit** (demande de la
  session de livraison). *Précisé au code* : une preuve qui pose **son propre espace** (premier lancement, démarrage, guide,
  accueil, chapitre 3 du manuel) garde l'ancienne adresse, que la redirection mène dans le bon espace ; les attentes exactes
  sur l'adresse ou un `href` (`toHaveURL('/…')`, `toHaveAttribute('href', '/…')`) emploient `dansUnEspace`, qui accepte le
  slug de n'importe quel espace. Aucun texte du manuel ne cite une adresse : rien n'y fige `/p2enjoy/` (l'espace de
  production s'appelle `crm`).
- **Preuves propres** (`e2e/ui/espace-adresse.spec.ts`) : chaque ancienne adresse redirigée (le tableau du §15.4), un slug
  inconnu, la barre latérale d'un espace, deux onglets sur deux espaces (une seconde page du même contexte de navigation, un
  espace jetable posé par la clé de service), et une page globale qui garde l'espace de l'onglet.
- **Unitaires** : la composition des adresses, la résolution, le module de l'onglet.
- **pgTAP** : la contrainte des slugs réservés.

### 15.6 Le menu des espaces (T2.b)

Les règles du §9, et, de quoi il a l'air (section du design system écrite en T2.b, avant son code) :
- le premier niveau du fil devient un **bouton** (même classe que l'ancêtre-lien, §5.62, borné à `24ch`, nom complet en
  `title`), suivi de l'icône Lucide `ChevronsUpDown` 14 px, `aria-haspopup="menu"`, `aria-expanded` ;
- **la pastille du bouton** quand un **autre** espace a des non-lus : le patron du compteur de la cloche (§5.43),
  `--color-brand`, sans chiffre sur le bouton ; le nom accessible le dit (« Changer d'espace — des messages non lus dans un
  autre espace ») ;
- **le panneau** : le patron du repli « … » du fil (§5.62) — ancré à l'en-tête, surface, bordure, `--radius-lg`,
  `--shadow-card-hover` ; une ligne par espace, son nom et, à droite, son compte de non-lus de l'inbox (pastille `--color-brand`,
  `99+` au-delà, le compte exact dans le nom accessible) ; l'espace courant coché (`aria-current="true"`, icône `Check`) ;
- clavier : `Entrée`, `Espace` ou `↓` ouvre ; `↑` `↓` parcourent ; `Échap` referme et rend le focus au bouton ; un clic
  extérieur referme sans déplacer le focus ;
- **aucune couleur, aucun jeton nouveaux** ; deux icônes Lucide de plus, `ChevronsUpDown` et `Check`.

**La bascule annoncée** : un message bref dans la région `aria-live` polie de la coquille (§8), « Vous êtes passé dans
l'espace X. », sans bandeau visuel persistant.

### 15.7 Le seed de T2.b

*Précisé le 2026-11-21 : `docs/SPEC-seed.md` §55 ; l'espace est créé par la fonction de la plateforme et retrouvé par son slug (décision 972, accord avec la session f9) ; sa boîte système est une boîte Stalwart propre (`lumen@`).*

`docs/SPEC-seed.md` §55, écrit avec T2.b : « Studio Lumen » est créé par le §54 de `CRM-162` (accord, §12) ; le §55 y pose
le track, le channel, l'affaire, les deux mails déposés par IMAP et relevés (au moins un non lu), le contact, l'organisation,
le tableau d'objectifs et la saisie de temps du §12. Si le §54 n'est pas encore poussé au moment de T2.b, le §55 crée
l'espace sous l'identité figée, et le §54 l'enrichit.

## 16. La tranche T3 en détail — les pages globales

*Écrit le 2026-11-24 par la session ef (ex-5f), avant son code. Les réponses du connecteur valent pour toute l'unité (§1, §11,
décisions 963 et 965) : T3 n'ajoute ni famille ni case. Les choix que les décisions 963 à 976 ne tranchent pas sont nommés au
§16.6 et soumis au responsable ; rien de ce qui en dépend n'est codé avant sa réponse.*

### 16.1 Ce que T3 change, et pour qui

Les pages globales du §4 (marquées **G**) montrent **tous les espaces de la personne**, chaque ligne nommant le sien (§10). Pour
une personne d'**un seul espace** — la production aujourd'hui —, **rien ne change à l'écran** : ni colonne, ni mention, ni
filtre. L'état intermédiaire de T2 (§15.2 : `Carnet`, `ListeOrganisations`, `Objectifs`, `Pilotage` suivent l'espace courant de
l'onglet ; décision 976) prend fin écran par écran, chacun dans sa sous-tranche.

### 16.2 Les règles communes

- **La provenance** (§10) : une colonne « Espace » dans un tableau, en dernière colonne avant les actions ; une mention « nom de
  l'espace » en `text-xs text-text-3` sous le titre d'une ligne de liste ou d'une carte. Elle n'apparaît que si la personne lit
  au moins **deux** espaces (`ContexteEspace.espaces.length >= 2`).
- **Le filtre « Espace »** : un composant nouveau du design system (§5.115 — la §5.114 réservée a été prise par `CRM-165` —, écrit avec T3.a), une liste de cases à cocher
  repliée dans un bouton « Espace » de la barre de filtres de la page, aux mêmes règles que les filtres existants (clavier,
  `aria-expanded`, compteur de cases cochées dans le libellé). Il vit dans l'adresse : `?espaces=<slug>,<slug>` ; un slug
  inconnu est ignoré ; vide ou absent, tous les espaces. Absent de l'écran pour une personne d'un seul espace.
- **Le filtrage est fait par la lecture**, jamais en mémoire sur une liste entière, dès qu'une lecture est paginée
  (`organization_list`) ; une lecture non paginée peut filtrer en mémoire sur `workspace_id`.
- **Les créations** depuis une page globale (un contact, une organisation, un tableau d'objectifs, une saisie de temps) se font
  dans **l'espace courant de l'onglet** (§2), et le formulaire le **dit** (« Dans l'espace X ») dès que la personne en lit deux.
- **Les liens** d'une ligne mènent dans l'espace de sa ressource (§8.4, déjà fait en T2.a).
- **Les montants ne se somment jamais entre devises** (inchangé) ; un total multi-espaces reste par devise.

### 16.3 Écran par écran (mesures du 2026-11-24 sur la base de développement)

| Écran | Aujourd'hui | Lecture en T3 | Provenance | Filtre | Backend |
|---|---|---|---|---|---|
| Tableau de bord (`/`) | guide de l'espace courant | inchangé : le guide reste celui de l'espace de l'onglet (§4) | — | — | — |
| Ma journée | `card_placements`, tous les espaces | inchangée | mention sous chaque affaire | oui | aucun (`card_placements.workspace_id`) |
| Affaires figées | `cards_figees()`, tous | inchangée | dans l'en-tête de chaque groupe (la liste est groupée par dossier, §5.37 ; un dossier n'a qu'un espace) | oui | aucun (rend `workspace_id`) |
| Objectifs (liste) | `goal_boards` de l'espace de l'onglet | tous les espaces ; **groupés par espace**, une section par espace (l'ordre `position` n'a de sens que dans un espace) | titre de section | oui | aucun ; *précisé au code de T3.b.2* : une section par espace qui a des tableaux, dans l'ordre du menu ; monter et descendre restent dans la section ; la création dans l'espace de l'onglet, que le formulaire nomme |
| Objectifs (un tableau) | un tableau | inchangée ; le fil d'Ariane nomme son espace | — | — | — |
| Contacts (carnet) | l'espace de l'onglet (976) | tous ; filtre en mémoire (lecture non paginée, `docs/SPEC-contacts.md` §10.7) | colonne, la dernière | oui, entre les gestes et le tableau | aucun (`contacts.workspace_id`) ; *précisé au code de T3.b.2* : « Nouveau contact », l'export et l'import agissent dans l'espace de l'onglet, et la rangée des gestes le dit (« Dans l'espace X ») |
| Organisations | `organization_list(p_workspace_id …)`, un espace | tous, paginée | colonne | oui, **par la lecture** | **migration** : `p_workspace_ids uuid[]` facultatif (absent : tous les espaces lus), `workspace_id` rendu |
| Pilotage | l'espace de l'onglet (976) | **question Q1** (§16.6) | — | — | aucun (`entonnoir_conversion()` rend `workspace_id`) |
| Temps ▸ Saisie | l'espace de l'onglet | **question Q2** (§16.6) | — | — | — |
| Temps ▸ Rapport | `temps_valorise()`, **déjà tous les espaces, sans le dire** | tous | colonne | oui | **migration** : `temps_valorise` rend `workspace_id` |
| Coûts | budgets, coûts, recettes, tous | inchangées ; sous le filtre, les tracks lus sont restreints par la lecture (`workspace_id`), les totaux suivent ; les tracks rangés par espace | la précision du §5.30 sous chaque track du tableau équivalent (*précisé au code de T3.b*) | oui, au-dessus des histogrammes de « Vue d'ensemble » | aucun : l'espace se lit par la relation (`tracks`, `cards`), sans colonne nouvelle |
| Rentabilité | `rentabilite_affaires()`, tous | inchangée ; filtrée en mémoire ; les tracks rangés par espace | sur la ligne de chaque track, après son nom (*précisé au code de T3.b* : un track n'a qu'un espace) | oui | aucun (rend `workspace_id`) |
| Cloche | `notifications`, tous | inchangée | mention sous chaque notification | non (exception maintenue, décision 963) | aucun |
| Recherche globale | `recherche_globale()`, tous | inchangée | mention sous chaque résultat | non (idem) | aucun (rend `workspace_id`) |

### 16.4 Les deux relevés de la livraison de T1 et T2

- **Les non-lus de chaque espace sous `md`** (capture `docs/captures/CRM-161/menu-espaces-sm-390.jpg`) : `SectionEspacesDuRepli`
  ne lit `inbox_unread_by_workspace` qu'**à l'ouverture du repli**, et le menu en ligne fait de même à son montage ; la capture
  précède la fin de cette lecture. **Règle** : les non-lus par espace sont lus **une fois par la coquille**, relus à chaque
  changement d'adresse comme aujourd'hui, et **partagés** par le menu et le repli : ouvert, le repli les montre déjà. Preuve
  rouge avant : l'E2E du repli constate la pastille de la sonde **sans attente** après l'ouverture.
- **Les identités d'expédition du formulaire d'envoi** (limite de la décision 975) : `FormulaireEnvoi` reçoit l'espace de son
  objet — l'affaire (`RouteCard`), le message auquel il répond (`RouteInbox`) — et lit les identités de cet espace seul
  (`lireIdentitesDisponibles(client, idUtilisateur, idWorkspace)`, déjà prête).

- **Les organisations offertes à un contact** (*relevé le 2026-11-24 au code de T3.b.2*) : le sélecteur du formulaire de
  création (carnet) et de modification (fiche de contact) lisait toutes les organisations que la RLS rend, tous espaces
  confondus, alors que la base refuse un contact rattaché à l'organisation d'un autre espace
  (`contacts_organization_id_workspace_id_fkey`, clé composite) : choisir une organisation de « Studio Lumen » pour un
  contact de « P2Enjoy SAS » finissait sur un refus. **Règle** : `lireOrganisationsDuWorkspace(client, idWorkspace)` lit les
  organisations de l'espace de la création (l'onglet) ou du contact modifié (`contact.workspace_id`) seulement.

### 16.5 Le découpage

- **T3.a — le socle** : le composant « Espace » du design system (§5.115), la provenance (`lib/provenance.ts` : le nom d'un
  espace depuis `ContexteEspace.espaces`), l'adresse `?espaces=` ; les deux relevés du §16.4. Le socle est prouvé sur une
  page réelle : **« Affaires figées » est sa première page** (*précisé le 2026-11-24 au début du code* : un composant sans
  page ne se prouve pas en E2E). Unitaires ; E2E du filtre au clavier et à la souris avec Camille, qui lit « P2Enjoy SAS »
  et « Studio Lumen » dans le seed : ses quatre affaires figées sont toutes dans le premier, et isoler « Studio Lumen » rend
  le vide sous le filtre. Aucune affaire figée n'est ajoutée à « Studio Lumen » : le seed tient la suite exacte des quatre
  retards (`docs/SPEC-relances.md` §10.2.1), que plusieurs preuves assèrent entière.
- **T3.b — les listes sans backend** : Ma journée, Objectifs, Contacts, Coûts, Rentabilité, cloche, recherche. *Faite en
  développement le 2026-11-24* (T3.b.1 puis T3.b.2 ; les onglets « À saisir » nomment l'espace sous l'affaire, sans
  filtre, `docs/DESIGN_SYSTEM.md` §5.115). *Ordonné le
  2026-11-24 au code* : **T3.b.1** Rentabilité et Coûts (« Vue d'ensemble » ; l'onglet « À saisir » des deux écrans liste
  des lignes de tous les espaces et recevra sa provenance avec les listes) ; **T3.b.2** Ma journée, Objectifs, Contacts,
  cloche, recherche, et les deux onglets « À saisir ». Le composant du filtre se scinde pour une page qui a déjà sa barre :
  `BoutonFiltreEspaces` entre dans la barre, `PanneauFiltreEspaces` se place sous elle ; `FiltreEspaces` les assemble pour
  une page qui n'en a pas.
- **T3.c — les deux migrations** (`organization_list`, `temps_valorise`), leurs pgTAP, puis Organisations et le rapport de Temps.
- **T3.d — Pilotage et Temps ▸ Saisie**, selon les réponses à Q1 et Q2.

Chaque sous-tranche met à jour le manuel des pages touchées (« Les pages qui montrent tous vos espaces »), le seed (« Studio
Lumen » porte déjà de quoi montrer chaque page), le contrat de livraison et le changelog.

### 16.6 Les questions au responsable

- **Q1 — Pilotage.** Chaque espace a **son propre catalogue** d'étapes (« Prospection » de l'un n'est pas celle de l'autre) et
  ses propres tracks et channels de portée. Deux formes : (a) **un entonnoir par espace**, l'un sous l'autre, chacun avec son
  prévisionnel par devise, le filtre « Espace » en isolant un ; (b) **un seul entonnoir**, une ligne par étape **et** par
  espace, colonne « Espace » — les étapes homonymes y apparaissent deux fois. Recommandation : (a).
  Le responsable a fait remarquer que **le genre d'une étape (ouvert, gagné, perdu) est universel** ; la question lui a été
  reposée avec une troisième forme. **Tranché le 2026-11-24 (décision 982) : la tête globale, le détail par espace.** Les
  grandeurs de tête — prévisionnel par devise, taux de conversion des affaires décidées, affaires sans montant ou sans
  probabilité — ne reposent que sur le genre (`node_kind`) : elles sont calculées sur **tous les espaces** lus (après le filtre
  « Espace »), par devise, jamais entre devises. Suit **un entonnoir détaillé par espace**, chacun titré du nom de l'espace,
  avec ses propres étapes dans l'ordre de son catalogue ; la portée (track, channel) reste celle d'un espace et ne s'offre que
  lorsque le filtre en isole un. Une personne d'un seul espace voit l'écran d'aujourd'hui.
- **Q2 — Temps ▸ Saisie.** Une saisie appartient à un espace (clés composites), et « Saisir pour » liste les membres d'un
  espace. Deux formes : (a) **la grille reste dans l'espace courant de l'onglet** — seul le rapport devient global —, l'en-tête
  nommant l'espace et le menu des espaces en changeant ; (b) **une grille de tous les espaces**, groupée par espace, « Saisir
  pour » limité à soi-même dès que la grille couvre deux espaces. Recommandation : (a).
  **Tranché par le responsable le 2026-11-24 (décision 981) : (b), une grille de tous les espaces.** Les lignes (tracks,
  channels, affaires) sont groupées par espace, chaque groupe titré du nom de l'espace ; une saisie s'écrit dans l'espace de sa
  ligne (clés composites inchangées) ; les totaux par jour restent ceux de la personne, tous espaces confondus, et le seuil de
  la journée trop longue s'applique à ce total. « Saisir pour » : soi-même dès que la grille couvre deux espaces ; un
  administrateur qui saisit pour un collègue le fait **dans un espace choisi** — la grille se restreint alors à cet espace, les
  membres de la liste étant ceux de cet espace.

### 16.7 Les preuves

Par sous-tranche : un unitaire par lecture et par composant ; l'E2E de chaque page touchée sur un espace jetable dont Camille est
membre, à la souris et au clavier, aux quatre paliers, captures observées ; une preuve d'API ou pgTAP par migration, avec le
refus d'un espace non lu (la RLS reste la règle) ; une page d'un seul espace constatée **inchangée** (ni colonne ni filtre).

### 16.8 T3.c en détail — les deux migrations et leurs écrans

*Écrit le 2026-11-24 par la session 7a, avant le code, pendant le gel du lot T3.b (aucune migration n'est committée avant
l'annonce de fin de la session de livraison). Les réponses du connecteur restent celles du §16 (décisions 963 et 965) :
T3.c n'ajoute ni famille ni case.*

*Corrigé le 2026-11-24 par 7a, avant le code : la première rédaction disait qu'aucune des deux fonctions n'était appelée
par le connecteur, sur une recherche faite dans un dossier `mcp/src` qui n'existe pas. **Le connecteur appelle les deux**
(`mcp/crm_mcp/outils/organisations.py`, `crm_organization_list` ; `mcp/crm_mcp/outils/temps.py`, `crm_time_report`). Il
n'en est pas changé : il appelle `organization_list` par ses noms de paramètres avec `p_workspace_id`, que la migration A
garde, et il ne recopie que les colonnes qu'il nomme (`organisation_lue`, la ligne du rapport), si bien que la colonne
`workspace_id` ajoutée ne paraît pas dans ses réponses. Aucun code du connecteur ne change, aucune image `mcp` n'est à
reconstruire ; **la preuve est leur intégration sur la base migrée** (`test_integration_organisations.py`,
`test_integration_temps.py`), jouée par `scripts/verify-mcp.sh` après avoir prévenu la session de livraison.*

#### 16.8.1 Migration A — `organization_list` lit plusieurs espaces

- **Supprimée puis recréée** (son type de retour change), dans une transaction : `drop function
  public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[])`, puis la nouvelle
  définition et ses droits (`revoke all … from public, anon` ; `grant execute … to authenticated`).
- **Paramètres** : ceux d'aujourd'hui, `p_workspace_id uuid` devenant **facultatif** (`default null`), plus
  **`p_workspace_ids uuid[] default null`**. La portée est, dans cet ordre : `p_workspace_ids` s'il est non vide ;
  sinon `array[p_workspace_id]` s'il est donné ; sinon **tous les espaces que la RLS laisse lire**. *Garder
  `p_workspace_id` est un choix de compatibilité* : la webapp livrée avant la migration l'appelle encore, et la fenêtre
  de maintenance ne la remplace qu'après ; elle continue donc de fonctionner entre les deux gestes.
- **Retour** : celui d'aujourd'hui, plus **`workspace_id uuid`**, placé avant `total_count`. `total_count` compte toutes
  les lignes de la portée, tous espaces confondus.
- **Rien d'autre ne change** : la recherche, les filtres de tracks, de recettes et de catégories, le tri (`lower(name)`,
  puis `id`) et les bornes de pagination. `SECURITY INVOKER` : la RLS d'`organizations` reste la règle. **Un espace non lu
  passé dans `p_workspace_ids` ne rend aucune ligne, sans erreur** — c'est le refus, comme partout (`docs/SPEC-permissions-rls.md`
  §7).
- **pgTAP** : la signature et le type de retour ; la portée « tous » de Camille couvre ses deux espaces, chaque ligne
  portant le sien ; `p_workspace_ids` restreint ; `p_workspace_id` seul donne le résultat d'avant ; un espace non lu (la
  lectrice et « Studio Lumen ») ne rend rien ; `total_count` sur deux espaces ; les deux refus `22023` inchangés.
- **Retour arrière** : rétablir la définition de la `0188` (supprimer la nouvelle signature, recréer l'ancienne et ses
  droits). La webapp de T3.c l'appelle avec `p_workspace_ids` : elle se retire avec elle.

#### 16.8.2 Migration B — `temps_valorise` rend l'espace de chaque ligne

- **Supprimée puis recréée** (son type de retour change), dans une transaction, comme la `0150` l'a déjà fait :
  `rentabilite_affaires` l'appelle depuis un corps `plpgsql`, qui ne crée aucune dépendance et lit ses colonnes **par leur
  nom** ; elle n'est pas réécrite.
- **Retour** : les huit colonnes d'aujourd'hui, plus **`workspace_id uuid` en dernière position** (celui de la saisie). Le
  regroupement l'ajoute ; il ne scinde rien, une cible n'appartenant qu'à un espace.
- **Rien d'autre ne change** : paramètres, valorisation, `shared`, ordre, RLS (`security invoker`), droits (re-posés).
- **pgTAP** : la colonne et sa valeur sur une saisie de chaque espace ; une saisie d'un espace non lu reste absente ;
  `rentabilite_affaires` rend les mêmes sommes qu'avant sur le seed.
- **Retour arrière** : rétablir la définition de la `0150`.

#### 16.8.3 Les écrans

- **Organisations** (l'onglet du carnet) : à partir de deux espaces lus, la liste lit **tous les espaces** — ou ceux du
  filtre, passés en `p_workspace_ids` : **le filtre se fait par la lecture**, la liste étant paginée (§16.2). Colonne
  **« Espace »**, la dernière avant les actions (§5.115). Le bouton **« Espace »** entre dans la barre de filtres existante,
  avec « Tracks » et « Catégories », son panneau sous elle comme les leurs (§5.105) ; changer le choix revient à la
  première page. **Les cases « Tracks » et « Catégories »** listent celles des espaces de la portée (choisis, sinon tous),
  **groupées sous une sous-légende par espace** dès que la portée en couvre deux — deux tracks homonymes de deux espaces
  restent distincts. La création d'une organisation se fait dans l'espace de l'onglet et le dit (« Dans l'espace X »,
  §5.115). D'un seul espace : la liste d'aujourd'hui.
- **Temps ▸ Rapport** : la lecture est déjà celle de tous les espaces ; à partir de deux espaces, la ligne de chaque
  **track** nomme son espace (la forme de « Rentabilité », un tableau arborescent, §5.115), et le bouton **« Espace »**
  filtre **en mémoire** (la lecture n'est pas paginée), placé après la navigation de mois. **Limite nommée** : le choix de
  la personne (« Toute l'équipe », un membre) reste celui des membres de l'espace de l'onglet ; l'étendre relève de T3.d
  (Temps ▸ Saisie, décision 981).
  *Précisé au code le 2026-11-24 (7a), avant l'écriture de l'écran* : **le rapport n'est pas un tableau arborescent**. Une
  ligne y est une cible qui porte du temps DIRECT (`composerRapport`) : un track n'a sa ligne que si l'on a saisi sur le
  track lui-même, et une affaire paraît sans la ligne de son track ; deux tracks homonymes de deux espaces peuvent même
  entremêler leurs lignes, triées par nom. La mention « sur la ligne du track » n'aurait donc pas de ligne où se poser.
  **Le rapport prend la règle par défaut d'un tableau** (`docs/DESIGN_SYSTEM.md` §5.115) : une colonne **« Espace »**, la
  dernière, sur chaque ligne de chaque section, à partir de deux espaces lus. Le filtre en mémoire, son placement et la
  limite du choix de la personne ne changent pas ; le vide sous le filtre est celui du §5.115.
  *Précisé au code le 2026-11-25 (7a)* : **le vide de l'onglet « Organisations » se juge sur la portée des lignes montrées**,
  non sur l'adresse : sitôt « Afficher tous les espaces » pressé, et avant la relecture, l'onglet n'est pas « vide », et la
  barre — où le focus revient au bouton « Espace » — reste montée (trouvé par le test unitaire, rouge avant la correction).
  **Les preuves qui lisent l'espace du seed** (`organisations-recherche`, `recettes-organisation`, le scénario 10 du
  manuel) ouvrent l'onglet sous `?espaces=p2enjoy` : Camille lit aussi « Studio Lumen », où vit un homonyme de Vertigo
  Conseil (seed §54). Le seed n'a pas de catégorie dans « Studio Lumen » : le groupement des cases « Catégories » y montre
  le seul groupe de « P2Enjoy SAS » ; il est prouvé à l'unité sur deux catalogues.
- **Les numéros des deux migrations** sont pris à leur commit, après synchronisation et après l'annonce de fin de la
  session de livraison (CLAUDE.md §5) ; le contrat de livraison les consigne alors, avec l'ordre « migrations, puis
  webapp » et leur retour arrière.

### 16.9 T3.d en détail — le Pilotage et Temps ▸ Saisie

*Écrit le 2026-11-25 par la session 7a, avant le code, pendant le gel du lot T3.c (documents seuls, avec l'accord de la session
de livraison ; le numéro de la migration est pris à son commit, après l'annonce de fin). Les formes sont celles du
responsable : décision 982 (le Pilotage), décision 981 (la saisie). **Connecteur MCP** : les réponses du §16 tiennent
(décisions 963 et 965) — ni famille ni case nouvelle, aucun outil nouveau. `crm_time_set` hérite du plafond tous espaces par
la base (§16.9.3), sans changement de code : il reconnaît le refus par son message, `plafond journalier`, qui ne change pas.*

#### 16.9.1 Le Pilotage — la tête globale, le détail par espace (décision 982)

- **La lecture ne change pas** : `entonnoir_conversion()` rend déjà toutes les lignes que la personne lit, chacune avec son
  `workspace_id` ; **aucune migration**. Le catalogue (`lireNoeudsCatalogue`) et les portées offrables
  (`lirePorteesOffrables`) sont lus **par espace**, pour les espaces affichés.
- **D'un seul espace : l'écran d'aujourd'hui**, au pixel près.
- **À partir de deux espaces lus** :
  - **le filtre « Espace »** (§16.2, §5.115), en mémoire (la lecture n'est pas paginée), son bouton en tête de l'écran,
    avant le sélecteur de portée ;
  - **la tête** — les grandeurs du prévisionnel par devise et du taux de conversion des affaires décidées — est calculée sur
    les lignes **de tous les espaces affichés** : elles ne reposent que sur le genre (`node_kind`), universel ; jamais
    entre devises ;
  - **suit une section par espace affiché qui a des lignes**, dans l'ordre du menu (§5.113), titrée de son nom en `h2`
    (§5.115, « par section ») ; elle porte **ses entonnoirs par devise**, ses étapes dans l'ordre de **son** catalogue, et
    sa mention des étapes sans affaire (§8 bis.5 de `docs/SPEC-analytique.md`), nommées dans son catalogue ;
  - **les mentions de tête** (les affaires sans montant, sans probabilité) restent sous la tête, sur tous les espaces
    affichés ;
  - **la portée (track, channel) ne s'offre que lorsque le filtre isole un espace** : le sélecteur paraît alors, avec les
    tracks et channels de cet espace ; sinon il est absent, et une portée de l'adresse (`track=`, `channel=`) ne s'applique
    pas — elle se résout sur l'espace entier, comme un slug inconnu aujourd'hui (§8 bis.2). **Choisir une portée garde le
    filtre** : l'adresse est reconstruite avec `espaces=` (précision de T3.d : aujourd'hui, les paramètres sont reconstruits
    sans fusion, ce qui perdrait le filtre) ;
  - **le vide** : aucune ligne dans les espaces choisis est le vide sous le filtre (§5.115) ; aucune ligne du tout reste le
    vide de l'écran.

#### 16.9.2 Temps ▸ Saisie — une grille de tous les espaces (décision 981)

- **D'un seul espace : la grille d'aujourd'hui.**
- **À partir de deux espaces lus, pour soi-même** :
  - la grille lit **les tracks et channels de tous les espaces lus** (`lireArbreTemps` sans espace, `workspace_id` ajouté
    aux colonnes), **les saisies de la personne dans tous ses espaces** (`lireSaisies` sans espace), et les affaires avec
    leur espace (`cards.workspace_id`) ; une affaire trouvée par « Ajouter une affaire » se range dans le groupe de son
    espace ;
  - **les lignes sont groupées par espace**, dans l'ordre du menu, chaque groupe ouvert par une ligne de groupe à son nom
    (`th scope="rowgroup"` sur toute la largeur, §5.115) ;
  - **une cellule écrit dans l'espace de sa ligne** : `workspace_id` de l'insertion est celui du track, du channel ou de
    l'affaire de la ligne — les clés composites `(cible, workspace_id)` refusent toute autre combinaison ;
  - **les totaux par jour sont ceux de la personne, tous espaces confondus**, et l'annonce de la journée trop longue
    s'applique à ce total, comme le plafond en base (§16.9.3) ;
  - **pas de filtre « Espace »** sur la saisie (*choix de l'agent*) : masquer un espace laisserait ses minutes dans des
    totaux qui ne les montreraient plus, et la page est un écran de saisie, comme les onglets « À saisir » (§5.115).
- **« Saisir pour »** (administrateurs) : la liste offre **« Moi-même »** — la grille de tous les espaces —, puis, **pour
  chaque espace dont la personne est administratrice** (`mon_role_espace`, lu par espace), un groupe d'options (`optgroup`)
  titré du nom de l'espace, avec ses membres (`lireMembresAffectables`). Choisir un collègue **restreint la grille à cet
  espace** (l'arbre et les saisies de cet espace seul) ; ses totaux par jour restent ceux que la personne connectée **lit**
  de ce collègue, la base tenant seule le plafond sur son total réel (§16.9.3). D'un seul espace, la liste d'aujourd'hui.
- **Temps ▸ Rapport, la limite nommée de T3.c levée** : le choix de la personne offre « Moi-même », les membres **des espaces
  dont la personne est administratrice**, dédoublonnés et rangés par nom, puis « Toute l'équipe » ; la lecture reste
  `temps_valorise` sous la RLS, qui ne rend à un administrateur que le temps des espaces qu'il administre.

*Précisé au code le 2026-11-25 (7a)* :
- **Pilotage** : la section d'un espace est rendue même quand le filtre n'en garde qu'un (son nom en `h2`, le niveau des titres de
  devise passant à `h3`) ; la phrase de portée de la tête dit « dans les espaces affichés » à partir de deux espaces
  (`pilotage.scope.spaces`) ; les étapes sans affaire sont lues **par espace affiché** (le catalogue de chacun), jamais sur les
  lignes d'un autre ; sans espace isolé, la portée de l'adresse (`track=`, `channel=`) se résout sur l'espace entier, sans
  erreur ; le vide sous le filtre ne s'applique qu'à une portée « espace entier » (une portée vide garde le sien).
- **Temps ▸ Saisie** : la liste « Saisir pour » lit le rôle de la personne **dans chaque espace lu** (`mon_role_espace`, un
  appel par espace), puis les membres des seuls espaces administrés ; la valeur d'une option de collègue est
  `espace|personne` ; **une ligne dont l'espace n'est pas connu n'est jamais perdue** (un dernier groupe, « Autres lignes »,
  comme l'affaire dont le channel n'est plus lisible) ; une note sous la grille dit que le total du jour compte tous les
  espaces ; un déplacement aux flèches suit **l'ordre affiché**, d'un groupe au suivant.
- **Les preuves qui lisaient l'espace du seed** (`pilotage.spec`) ouvrent l'écran sous `?espaces=p2enjoy` ; leurs adresses
  attendues portent ce paramètre en dernier.

#### 16.9.3 La migration — le plafond journalier compte tous les espaces de la personne

- **`app.saisies_temps_plafond`** (redéfinie en dernier par la `0197`) est **remplacée** (`create or replace`, même
  signature, même déclencheur) :
  - le verrou consultatif sérialise **une personne et un jour, tous espaces confondus** :
    `hashtextextended('saisies_temps:' || profile_id || ':' || jour, 0)` — l'espace sort de la clé ;
  - la somme compte **les saisies de la personne ce jour-là dans tous les espaces** (`SECURITY DEFINER` : elle voit celles
    d'un espace que l'auteur de l'écriture ne lit pas) ;
  - **le refus garde son message**, `plafond journalier` (le contrat de la webapp et du connecteur) ; **son détail ne dit
    plus les minutes déjà saisies** — elles compteraient désormais celles d'espaces que l'auteur ne lit pas peut-être (un
    administrateur qui saisit pour un collègue) : `la journée de cette personne dépasserait 420 minutes` ;
  - le drapeau du déplacement d'un track (`app.track_move`, décision 969) laisse toujours passer.
- **Ce qui reste visible, et c'est la conséquence de la décision 981** : un refus du plafond apprend à un administrateur d'un
  espace que son collègue a du temps saisi ailleurs ce jour-là, sans en dire la quantité ni l'espace. **Acceptée par le
  responsable le 2026-11-25 (décision 989)** (§16.9.5).
- **pgTAP** : deux saisies d'une même personne, un même jour, dans deux espaces, qui dépassent ensemble 420 minutes — la
  seconde refusée ; ensemble sous 420 — acceptées ; un seul espace — inchangé ; le détail sans minutes ; le drapeau du
  déplacement respecté. **API** : la même preuve avec le jeton réel de Camille (« P2Enjoy SAS » puis « Studio Lumen »).
- **Avant la livraison** : une lecture de la production compte les couples personne × jour dont le total tous espaces dépasse
  420 minutes — la production n'a qu'un espace aujourd'hui, le compte attendu est zéro ; un couple au-delà rendrait toute
  écriture de ce jour refusée jusqu'à correction.
- **Retour arrière** : rétablir la définition de la `0197`.

#### 16.9.4 Les preuves

Celles du §16.7 : unitaires des lectures (l'arbre et les saisies de tous les espaces, le groupement, la tête sur plusieurs
espaces, la portée offerte sur un seul) et des composants ; pgTAP et API de la migration ; E2E du Pilotage et de la saisie
pour Camille (deux espaces) et la lectrice (un), souris et clavier, quatre paliers, captures observées ; une page d'un seul
espace constatée inchangée ; `verify-mcp.sh --rapide` sur la base migrée (`crm_time_set`). Le seed porte déjà de quoi les
montrer : l'affaire « Clip — Maison Arlo » de « Studio Lumen » (le Pilotage), son track « Productions » et la saisie de
Camille (la grille).

#### 16.9.5 Ce qui attend le responsable

- **Q3 — le refus du plafond entre espaces** (§16.9.3) : la décision 981 applique le plafond au total de la personne ; un
  refus dit donc à un administrateur qui saisit pour un collègue qu'il a du temps ailleurs ce jour-là (ni combien, ni où).
  Recommandation : l'accepter, le détail du refus étant sans minutes. **Tranché le 2026-11-25 (décision 989) : accepté** —
  le plafond sur le total tous espaces, le refus sans minutes ni espace.


## 17. La tranche T4 en détail — le connecteur

*Écrit le 2026-11-25, avant le code de T4 (décision 998), après la lecture du catalogue du connecteur (`mcp/crm_mcp/outils/`,
135 outils relevés par leur déclaration) et de la politique (`mcp/crm_mcp/politique.py`, `resoudre`). Accord avec la session
de livraison (p2enjoy-crm-11, 2026-11-25 : « T4 puis T5 »).*

### 17.1 Les deux questions du connecteur (`CLAUDE.md`, « Spécificités du projet »)

- **Question 1 — la fonctionnalité existe-t-elle aussi dans le connecteur ?** Oui, **au sens étroit déjà décidé** (décision
  965, §11) : les outils agissent déjà dans un espace ; T4 vérifie ce fait et corrige **un seul rendu**, le lien de relecture
  d'`crm_mail_prepare`. **Aucun outil nouveau.**
- **Question 2 — famille nouvelle ou existante ?** **Aucune famille, aucune case.** Le lien rendu reste de la famille
  `messagerie` (action `ajouter`, `crm_mail_prepare` ; `consulter`, `crm_mail_draft_list`) ; la matrice, la migration de la
  liste fermée et l'onglet « Connecteur MCP » ne changent pas. Réponses déjà consignées par la décision 965 et par §11 ; la
  décision 998 les reprend sans les rouvrir.

### 17.2 L'audit outil par outil — la règle, et ce que l'on constate

La règle (§6) : **chaque outil se déclare avec une ancre**, et la matrice se contrôle dans l'espace que l'ancre désigne ; **un
outil ne rend que des éléments de cet espace**, sauf les deux outils multi-espaces par nature, qui rendent l'espace de chaque
élément. Le relevé du 2026-11-25 sur les 135 outils :

| Classe | Outils | L'espace est… | Ce qui l'impose |
|---|---|---|---|
| **A. Ancre `workspace:workspace`** | 29 — les listes (`crm_track_list`, `crm_channel_list`, `crm_card_list`, `crm_stale_card_list`, `crm_card_mine`, `crm_contact_list`, `crm_organization_list`, `crm_organization_category_list`, `crm_goal_board_list`, `crm_budget_list`, `crm_costs_to_enter`, `crm_revenues_to_enter`, `crm_profitability_report`, `crm_time_entry_list`, `crm_time_report`, `crm_workflow_list`, `crm_workflow_node_list`, `crm_common_field_list`, `crm_mail_draft_list`, `crm_mail_outbox_list`, `crm_mail_trash_list`, `crm_mail_label_list`) et les créations d'un espace (`crm_track_create`, `crm_contact_create`, `crm_organization_create`, `crm_time_entry_set`, `crm_workflow_create`, `crm_workflow_starter_create`, `crm_workflow_node_create`) | **celui que l'argument `workspace` nomme** (slug ou identifiant) | chaque lecture ou écriture passe `appel.espace`, l'identifiant résolu par la politique : `workspace_id=eq.<espace>` ou `p_workspace_id` |
| **B. Ancre sur un objet** (`card`, `message`, `track`, `channel`, `workflow`, `organisation`, `contact`, `board`, `outbox`, `draft`, …) | 104 | **celui de l'objet**, résolu par la politique (`RESOLUTIONS`, `RESOLUTIONS_RPC`) avant l'outil | l'outil lit et écrit **par l'identifiant de l'objet** ; ce qui y est lié se lit sous la RLS de la personne |
| **C. Multi-espaces par nature** | 2 — `crm_workspace_list`, `crm_search` | **tous ceux que la personne lit** | `crm_search` rend le `workspace_id` de chaque résultat ; `crm_workspace_list` rend les espaces eux-mêmes |

- **Aucun outil ne liste l'inbox** (pas d'équivalent de `inbox_messages`) : rien à aligner pour l'inbox. Les outils de
  messagerie lisent un message **par son identifiant** (classe B), et l'outbox, les mails préparés et la corbeille **par un
  espace nommé** (classe A).
- **Les outils des pages globales** (`crm_contact_list`, `crm_organization_list`, `crm_goal_board_list`, `crm_time_report`,
  `crm_costs_to_enter`, `crm_revenues_to_enter`, `crm_profitability_report`, …) **restent à un espace par appel** : l'assistant
  lit un espace après l'autre, et `crm_workspace_list` lui donne la liste. La webapp, elle, lit plusieurs espaces d'un coup
  (§10, T3.c, T3.d) ; **les migrations `0201` à `0203` ne changent pas le connecteur** — `organization_list` garde sa forme
  d'appel (`p_workspace_id`), `temps_valorise` gagne une colonne que le connecteur ne rend pas, le plafond journalier de
  `0203` compte tous les espaces **et le connecteur en subit le refus tel quel** (`plafond journalier`, sans minutes ni
  espace : décision 989).
- **Le seul lien que le connecteur compose** est `review_url` (`crm_mail_prepare`, `crm_mail_draft_list`).

### 17.3 Ce que T4 change : le lien de relecture

- **Avant** : `{SITE_URL}/inbox?brouillon=<id>` — une ancienne adresse (§8.4) : la webapp la redirige vers l'espace du mail
  préparé (`mail_drafts.workspace_id`), au prix d'un écran de résolution.
- **Après** : **`{SITE_URL}/<slug-de-l'espace>/inbox?brouillon=<id>`**, l'adresse définitive : elle ouvre directement la
  relecture dans l'espace du brouillon. Le slug est celui de **l'espace de l'ancre** (`appel.espace`), lu **sous le jeton de la
  personne** (`workspaces`, `id=eq.<espace>`, `select=slug`) : la RLS, la seule règle d'accès, répond.
- **L'ordre** : dans `crm_mail_prepare`, **le slug est lu avant tout dépôt de fichier et avant `prepare_email`** — un mail
  préparé ne doit pas exister sans pouvoir rendre son lien. Dans `crm_mail_draft_list`, il est lu une fois pour la page.
- **Une lecture qui échoue ou ne rend pas exactement une ligne est un refus** (`Introuvable ou hors de votre périmètre : …`) :
  **aucun retour silencieux à l'ancienne adresse**, qui dissimulerait l'écart (`CLAUDE.md` §18).
- **L'ancienne adresse reste servie** par la redirection (§8.4) : un lien déjà donné à la personne continue d'ouvrir le bon
  espace. La webapp ne change pas.

### 17.4 Les preuves nommées de T4

| Niveau | Ce qui est prouvé |
|---|---|
| **Unitaires du connecteur** (`mcp/tests/test_messagerie.py`) | `crm_mail_prepare` rend `{origine}/atelier/inbox?brouillon=…` pour l'espace A et `{origine}/bureau/…` pour l'espace B ; `crm_mail_draft_list` de même ; **le slug est lu avant `prepare_email`** (l'ordre des appels) ; une lecture du slug qui échoue : refus, **aucun appel à `prepare_email`**, aucun dépôt |
| **Garde d'audit** (`mcp/tests/test_espace_courant.py`) | pour **chaque** outil du catalogue (lu par sa déclaration) : une ancre est déclarée ; la classe A n'écrit ni ne lit qu'avec `appel.espace` ; la classe C est **exactement** `crm_workspace_list` et `crm_search` ; **aucun outil ne compose une adresse de la webapp sauf `lien_de_relecture`**, et celui-ci porte le slug |
| **Intégration** (`mcp/tests/test_integration_espace_courant.py`, contre la vraie base, Keycloak et le vrai service `mcp`) | la personne membre des deux espaces du seed (§12) : un mail préparé dans « Studio Lumen » rend `/studio-lumen/inbox?brouillon=…`, un dans « P2Enjoy SAS » `/p2enjoy/inbox?brouillon=…` ; la liste des mails préparés de chaque espace ne rend que les siens ; les listes de la classe A d'un espace ne rendent **aucune ligne de l'autre** ; `crm_search` rend le `workspace_id` des deux |
| **Webapp** | une adresse rendue par le connecteur **s'ouvre sur la relecture** (E2E existant `mails-prepares`, adresse préfixée) |

**Le manuel ne change pas pour T4** : le chapitre 33 (« Le connecteur MCP ») ne cite l'adresse d'aucun lien rendu (vérifié
par recherche de `brouillon=` dans `docs/manual.md`) ; la personne ne voit que le lien, qui ouvre la relecture comme avant.

### 17.5 Livraison de T4

**L'image `mcp` est à reconstruire et à redéployer** (le code du connecteur change) — après la webapp, ou avant : l'ancien
lien reste servi par la redirection ; **aucune migration, aucune variable** (`SITE_URL` existe). Au contrat
(`docs/PROD_MIGRATIONS.md` §2.84).

## 18. La tranche T5 en détail — le manuel et la remise

*Écrit le 2026-11-25, avant le code et le texte de T5 (décision 999), après la relecture de `docs/manual.md` §3.2 bis, des
chapitres 10, 26, 28, 30 et 33, et de `docs/SPEC-manual.md`. Le plan du manuel est `docs/SPEC-manual.md` (le « `MANUAL_PLAN.md` »
du §14 n'existe pas : écart de nom, consigné à `docs/INCONSISTENCY_REPORT.md`).*

### 18.1 Ce que le manuel dit déjà, et ce qui manque

La section **3.2 bis « Changer d'espace »** (T2.b, complétée par T3.a et T3.b) dit déjà : le menu des espaces et ses non-lus ; ce
qui appartient à un espace ; le bouton **Espace** et son panneau ; l'espace dans l'adresse ; le clavier. Les chapitres 10, 28 et 30
disent, page par page, la colonne, le bouton et les règles de leur écran (T3.c, T3.d). **Il manque** :

1. **La liste des pages qui ont le bouton « Espace »**, arrêtée à T3.b : y entrent les **organisations** (chapitre 10), le **rapport
   de temps** et la **saisie du temps** (chapitre 28), le **Pilotage** (chapitre 30) ;
2. **Créer depuis une page qui rassemble vos espaces** : le formulaire nomme l'espace où l'élément sera créé (« Dans l'espace … ») ;
   sans filtre et avec plusieurs espaces, c'est l'espace de l'onglet ;
3. **Le plafond de la journée** compte tous les espaces (chapitre 28 le dit ; §3.2 bis y renvoie) ;
4. **L'assistant (chapitre 33)** : chaque outil agit dans **un** espace (celui qu'on lui nomme, ou celui de l'élément qu'il touche), un
   assistant lit donc vos espaces l'un après l'autre ; seules la liste des espaces et la recherche rendent tous vos espaces, chaque
   résultat nommant le sien ; **le lien de relecture** d'un mail préparé ouvre la relecture dans l'espace du mail (T4) ;
5. **Une image du bouton « Espace » ouvert** sur une page à deux espaces (aucune image n'existe pour le panneau).

### 18.2 Ce que T5 écrit

- `docs/manual.md` : §3.2 bis complétée (points 1, 2, 3, une image) ; chapitre 33, un court paragraphe (point 4) ; **aucune capture
  nouvelle sauf le panneau du filtre** (`filtre-des-espaces.jpg`, scénario `e2e/manuel/03-naviguer.spec.ts`, sous la section
  `changer-d-espace`) ; `scripts/manuel/construire.mjs`, puis `scripts/verify-manual.sh`.
- `docs/INCONSISTENCY_REPORT.md` : l'écart `MANUAL_PLAN.md` / `SPEC-manual.md`, **sans le résoudre** (le §14 est corrigé à la ligne
  près dans la même tranche : c'est une référence de nom, non une règle).
- **La remise à la session de livraison** : un message qui dit le lot de `CRM-161` T3.c à T4 dans l'ordre de livraison (migrations
  201, 202, 203 ; webapp, manuel ; image `mcp`), les gestes préalables du contrat (§2.80, §2.81, §2.84), et ce qui reste au constat
  du responsable. L'unité reste `[~]` jusqu'à ce constat, puis `[P]` à la livraison (`CLAUDE.md` §5).

### 18.3 Les preuves de T5

| Niveau | Ce qui est prouvé |
|---|---|
| **Le manuel** | `scripts/verify-manual.sh` vert (liens, images, citations du texte de l'interface) ; la liste des pages de §3.2 bis **égale** celle des pages qui montrent le bouton (relevée dans le code : `BoutonFiltreEspaces` / `FiltreEspaces`) |
| **Le scénario** | `e2e/manuel/03-naviguer.spec.ts` rejoué : la capture du panneau, prise sur Camille (deux espaces) ; `git checkout -- docs/manuel/images` pour les images que la campagne de la session de livraison renouvelle |
| **Visuel** | la capture est observée |
