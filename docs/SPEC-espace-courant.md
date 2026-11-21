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

Le carnet (`Carnet`, page globale) garde sa lecture entière. **Limite connue** : le formulaire d'envoi (`FormulaireEnvoi`) lit encore les identités
d'expédition de la personne dans tous ses espaces — il ne reçoit que l'affaire ; sans effet tant qu'une personne n'a
d'identité que dans un espace (le cas du seed), il est repris avec T3. **Preuves** : un unitaire par lecture (le filtre émis quand
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
