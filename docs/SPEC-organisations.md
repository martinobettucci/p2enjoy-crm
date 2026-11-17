# Spécification — les organisations : les lister, les créer, les modifier

- Unité de backlog : `CRM-114` — Organisations : les créer et les modifier depuis l'écran.
- Arbitrages : `docs/JOURNAL.md`, décision 660 (unité, connecteur oui, famille distincte `organizations`, sans
  suppression) et sa précision sur le nom de la famille (décision 658, règle 8).
- État : **validée le 2026-10-24** (décision 663).
- Connecteur MCP : **oui**, dans une **famille nouvelle `organizations`** (décision 659 : une permission distincte),
  avec sa migration de la liste fermée (§5 ci-dessous).

## 1. Le besoin

`CRM-060` a livré le carnet, la fiche d'organisation et le rattachement des contacts. Il a nommé parmi ses limites
« aucune création d'organisation » (`docs/SPEC-contacts.md` §14.7) et « aucune liste d'organisations » (§11.8), puis
s'est close sans qu'une unité ne les porte. Aujourd'hui, une organisation ne naît que par le seed, et ne s'atteint que
par le nom d'un de ses contacts.

La base est prête : la table `organizations` (nom, domaine, site web), ses contraintes de forme, l'unicité du domaine par
espace, et les politiques `organizations_insertion_bizdev_admin` et `organizations_maj_bizdev_admin`. **Aucune règle
nouvelle n'est écrite en base** : seule la liste fermée des familles du connecteur change (§5).

## 2. Ce qui est livré

| Geste | Où | Ce qu'il écrit |
|---|---|---|
| **Lister** les organisations de l'espace | un onglet **« Organisations »** du carnet, à côté de « Contacts » | lecture de `organizations`, par nom, avec le nombre de contacts rattachés |
| **Créer** une organisation | **« Nouvelle organisation »**, en tête de l'onglet, formulaire dans la page | `POST organizations` : nom (obligatoire), domaine, site web (facultatifs) |
| **Modifier** une organisation | **« Modifier »** sur sa fiche, formulaire dans la page, prérempli | `PATCH organizations` : les trois champs ; un champ facultatif vidé est effacé |

Après la création, la fiche de la nouvelle organisation s'ouvre. Après la modification, la fiche est relue.

**Ce qui n'est pas livré.**
- **Aucune suppression.** La base la permet, mais elle est une destruction : les contacts perdraient leur organisation
  sans trace. Décision 660 : pas de suppression.
- **Aucune création d'organisation depuis le formulaire d'un contact.** Le sélecteur continue de n'offrir que celles qui
  existent ; on crée d'abord l'organisation dans l'onglet.
- **Aucune fusion de doublons**, aucun rapprochement automatique par domaine.

## 3. Droits et refus

**Les droits sont ceux de la base** : créer et modifier sont réservés au **business developer** et à l'**administrateur**
de l'espace ; tout membre lit. L'écran lit la capacité « éditer l'espace » (`edition_permise`, `CRM-093`) et éteint les
deux commandes avec le motif générique quand la base la refuse (`docs/DESIGN_SYSTEM.md` §5.59), comme « Nouveau contact ».

**Refus traduits par un dictionnaire fermé** :
- nom vide (`organizations_name_check`) ;
- domaine de forme invalide (`organizations_domain_check`) — « minuscules, chiffres, tirets et points, par exemple
  sogexia.fr » ;
- site web invalide (`organizations_website_check`) — « une adresse commençant par http:// ou https:// » ;
- **domaine déjà pris** dans l'espace (`23505` sur `organizations_workspace_domain_key`), qui nomme le conflit sans
  dévoiler plus que ce que la personne lit déjà ;
- droit refusé (`42501`, ou zéro ligne rendue) ;
- réseau, inconnu.

Un refus s'écrit dans le formulaire, la saisie conservée.

## 4. Ce qu'on en voit

- **Le carnet passe à deux onglets-liens**, « Contacts » et « Organisations », sur le patron du §12.1 du design system ;
  l'adresse porte l'onglet (`/contacts` et `/contacts/organisations`).
- **L'onglet « Organisations » est un tableau du §5.9** : nom (lien vers la fiche), domaine et site web en données
  techniques, nombre de contacts aligné à droite. États : chargement, erreur avec reprise, vide (« Aucune organisation
  dans cet espace. », la commande restant offerte).
- **La fiche d'organisation gagne « Modifier »**, sur le patron de la fiche d'un contact (`CRM-060` 4g).
- **Design system** : une section nouvelle, écrite après lecture intégrale du document, avant le code de l'écran.
- **Depuis `CRM-146`** (`docs/SPEC-recettes.md` §12, décisions 900 et 903) : la liste porte une cinquième colonne, « Réel
  sur prévu », une barre par devise ; la fiche, un bloc « Recettes avec cette organisation ». Une affaire compte pour une
  organisation par ses contacts rattachés.

## 5. Le connecteur MCP — famille `organizations`

**Migration** (au prochain numéro libre) : `organizations` ajoutée **aux quatre listes fermées** que `0095` a étendues
pour `recettes` — la contrainte `mcp_droits_famille`, `public.mcp_autorise`, `public.mcp_compte` et
`public.mcp_poser_droits` —, après `contacts`. Aucune autre table ni politique. La matrice de l'onglet « Connecteur MCP » gagne la ligne
« Organisations », avec sa phrase de portée ; celle de « Contacts » devient « Contacts du carnet ».

| Outil | Action | Ancre | Ce qu'il appelle |
|---|---|---|---|
| `crm_organization_list` | `consulter` | `workspace:workspace` | `organizations`, par nom ou domaine (`query`) ; paginé |
| `crm_organization_get` | `consulter` | `organisation:organization_id` | la fiche et ses contacts |
| `crm_organization_create` | `ajouter` | `workspace:workspace` | `POST organizations` |
| `crm_organization_update` | `modifier` | `organisation:organization_id` | `PATCH organizations` |

**Aucun outil de suppression** (décision 660). Les noms suivent la décision 658 : anglais pour ce qui est exposé.

**La recherche suit la famille** (décision 666, conséquence de la décision 659) : `crm_search` filtre un résultat
`organisation` par `organizations:consulter`, et non plus par `contacts:consulter`. Le détail de la tranche est au
`docs/SPEC-mcp.md` §9.2 *sexies*.

## 6. Preuves

- **pgTAP** : la famille `organizations` acceptée par les quatre listes, refusée hors liste ; `mcp_autorise` sur la
  nouvelle famille ; les politiques existantes de `organizations` par profil (lectrice refusée en écriture, business
  developer accepté).
- **API** aux jetons réels : créer, modifier ; refus de la lectrice ; domaine en double ; zéro ligne.
- **Unitaires** : la bibliothèque (lecture, écritures, refus traduits) ; l'onglet et les formulaires ; les outils MCP.
- **Intégration MCP** contre la vraie pile, par outil : succès, refus par la matrice, refus par le CRM malgré la matrice
  ouverte, journal écrit.
- **E2E** : lister, créer au clavier puis ouvrir la fiche, modifier ; refus d'un domaine en double ; la lectrice voit
  les commandes éteintes avec le motif ; une organisation créée par le connecteur paraît dans l'onglet ; captures aux
  quatre paliers.
- **Seed** : une organisation **sans contact**, créée par la vraie route, pour que l'onglet montre ce que seul lui rend
  atteignable.
- **Manuel** : le chapitre du carnet (3 *ter*) et le chapitre 11 du connecteur.

## 7. Tranches

| Tranche | Contenu |
|---|---|
| T1 | Migration de la famille `organizations` ; pgTAP ; contrat de déploiement |
| T2 | Webapp : bibliothèque, onglet « Organisations », création, modification ; design system ; unitaires ; API |
| T3 | E2E, captures, seed, manuel, campagnes |
| T4 | Les quatre outils MCP ; matrice et phrases de portée ; intégration et E2E du connecteur |
| T5 | Livraison en production, sur instruction du responsable |

## 8. Les tracks d'une organisation ; rechercher, filtrer et trier la liste — `CRM-152`

*Écrit le 2026-11-18, avant le code (décisions 931 et 936).* **Connecteur MCP** : oui, famille existante `organizations`,
action `consulter` (décision 931) — `crm_organization_list` gagne la recherche sur le site web, le filtre par track, et rend
les tracks de chaque organisation ; aucune case nouvelle.

### 8.1 Les tracks d'une organisation

Une organisation est **rattachée à un track** quand l'un de ses contacts est lié (`card_contacts`) à une affaire placée dans
un channel de ce track (décision 931). **Ne comptent pas** : l'affaire à la corbeille (`cards.deleted_at`), le rattachement
archivé ou à la corbeille (`card_placements.archived_at`, `deleted_at`), le channel et le track archivés ou à la corbeille.
**Seul ce que la personne lit compte** : la règle est en base, sous la RLS de chaque table traversée — une affaire, un
channel ou un track illisible n'y entre pas, et rien ne trahit son existence.

`public.organization_tracks(p_organization_ids uuid[])`, `SECURITY INVOKER`, `stable` : une ligne par couple organisation et
track (`organization_id`, `track_id`, `name`, `slug`, `color`, `icon`), dans l'ordre des tracks de la barre latérale. Une
organisation sans track ne rend aucune ligne.

### 8.2 La liste, en base et paginée

`public.organization_list(p_workspace_id uuid, p_search text default null, p_track_ids uuid[] default null, p_revenues text
default 'all', p_sort text default 'name', p_descending boolean default false, p_limit integer default 50, p_offset integer
default 0)`, `SECURITY INVOKER`, `stable` : les organisations de l'espace que la personne lit, avec `id`, `name`, `domain`,
`website`, `contacts` (le nombre de contacts lus), `has_revenues`, et `total_count` (le nombre total qui répond aux filtres,
pour écrire « 50 sur 132 »).
- **`p_search`** : le nom, le domaine ou le site web contient le texte, sans casse ; les jokers `%` et `_` sont échappés ;
  blanc ou absent, aucun filtre.
- **`p_track_ids`** : rattachée à **l'un** des tracks donnés, par la règle du §8.1 (décision 936) ; vide ou absent, aucun
  filtre.
- **`p_revenues`** : `all` ; `with`, au moins une ligne de recette (`card_revenues`) sur une affaire hors corbeille liée par
  les contacts — la règle de `organization_revenue_totals` (`docs/SPEC-recettes.md` §12.1 : une affaire archivée y compte) ;
  `without`, aucune. Toute autre valeur : `22023 invalid_revenues_filter`.
- **`p_sort`** : `name` ou `contacts` ; le départage est toujours le nom puis l'identifiant, pour un ordre total. Toute autre
  valeur : `22023 invalid_sort`. **Aucun tri sur les recettes** (décision 936).
- **`p_limit`** ramené entre 1 et 100 ; `p_offset` ≥ 0.

### 8.3 L'écran — Contacts ▸ Organisations

- **Une barre de recherche et de filtres** au-dessus du tableau : « Rechercher » (nom, domaine, site web), **à la frappe**,
  avec un délai de 300 ms ; « Tracks », un choix multiple des tracks de l'espace ; « Recettes » : toutes, avec recettes,
  sans recettes. « Effacer les filtres » paraît dès qu'un filtre est posé.
- **Le tri** par les en-têtes « Nom » et « Contacts », ascendant puis descendant ; « Réel sur prévu » ne se trie pas.
- **Une colonne « Tracks »** après « Nom » : les noms des tracks de l'organisation (§8.1).
- **La pagination** : cinquante organisations, puis « Afficher plus » ajoute les cinquante suivantes ; « 50 sur 132 » est
  écrit sous le tableau. Un changement de recherche, de filtre ou de tri repart de la première page.
- **L'adresse porte les filtres et le tri** (`/contacts/organisations?q=…&tracks=…&recettes=avec&tri=contacts&sens=desc`),
  le défaut n'étant jamais écrit ; une valeur inconnue est repliée sur le défaut. La page chargée n'y vit pas.
- **Les totaux « Réel sur prévu »** restent lus par `organization_revenue_totals()`, une seule fois pour l'espace, à côté de
  la page : leur volume est celui des organisations qui ont des recettes. *Compromis assumé* : non paginé ; à revoir si ce
  volume croît (`CLAUDE.md` §21).
- **La fiche d'une organisation** porte une ligne « Tracks » dans sa liste de définitions : chaque track en lien vers sa
  vue ; aucun, la ligne dit « Aucun track ».
- Les états : squelette au premier chargement ; erreur avec « Réessayer » ; vide de l'espace (§4, inchangé) ; vide sous les
  filtres, « Aucune organisation ne correspond à ces filtres », avec « Effacer les filtres ».

### 8.4 Le connecteur — `crm_organization_list`

Il appelle `organization_list` sous le jeton de la personne. `query` cherche aussi dans le site web ; un argument nouveau,
**`tracks`**, une liste d'identifiants de track (« l'un d'eux ») ; chaque organisation rend ses **`tracks`** (`id`, `name`,
`slug`), et la réponse rend `total`. Pagination inchangée (`limit`, `offset`). Aucun filtre de recettes ni de tri dans le
connecteur : la décision 931 n'en retient pas. Le détail est au `docs/SPEC-mcp.md` §9.2 *tervicies*.

### 8.5 Preuves

- **pgTAP** : la règle des tracks (contact lié, affaire à la corbeille, rattachement archivé, channel et track archivés, un
  track illisible pour la lectrice) ; chaque filtre, le tri total, la pagination et `total_count` ; les deux refus `22023`.
- **API** aux jetons réels : la lectrice ne voit que ce qu'elle lit ; le business developer et l'administratrice.
- **Unitaires** : l'adresse (lecture, écriture, repli), la barre, le tri, « Afficher plus », la colonne et la fiche.
- **E2E** souris et clavier : chercher, filtrer par track et par recettes, trier, afficher plus, recharger l'adresse ; la
  fiche ; captures aux quatre paliers.
- **Connecteur** : pytest, intégration, `verify-mcp.sh`.
- **Seed** : il démontre déjà une organisation à plusieurs tracks, une sans track et une avec recettes ; le §8.5 le vérifie
  et le seed s'étend si un cas manque.
- **Manuel** : le chapitre du carnet, et le chapitre du connecteur.

### 8.6 Tranches

| Tranche | Contenu |
|---|---|
| T1 | Migration (`organization_tracks`, `organization_list`) ; pgTAP ; API ; types ; contrat |
| T2 | Webapp : la barre, le tri, la colonne, « Afficher plus », l'adresse, la fiche ; design system §5.105 ; unitaires ; E2E ; captures |
| T3 | Le connecteur : `crm_organization_list` ; pytest, intégration, `verify-mcp.sh` |
| T4 | Seed vérifié, manuel, contrat ; puis `[P]` |
