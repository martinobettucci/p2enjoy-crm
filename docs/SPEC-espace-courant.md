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

- un **second espace**, « Studio Lumen » (`studio-lumen`), trié **après** « P2Enjoy SAS » : l'espace par défaut reste
  « P2Enjoy SAS », et les preuves existantes ne changent pas d'espace ;
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
