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
