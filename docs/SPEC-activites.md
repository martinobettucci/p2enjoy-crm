# Spécification — les activités d'une affaire : appels, réunions, visios

- Unité de backlog : `CRM-067` — activités typées : appels, réunions, visios.
- Arbitrages : `docs/JOURNAL.md`, décisions 647 (unité suivante, connecteur MCP : oui) et 648 (quatre arbitrages),
  2026-10-23.
- État : **brouillon, à valider par le responsable avant tout code.**
- Connecteur MCP : **oui, dans la famille `affaires`** (décision 648, point 3) — actions `consulter`, `ajouter`,
  `modifier` ; aucune famille nouvelle. `CRM-104` n'étant pas livrée, les outils s'inscrivent à son catalogue
  (`docs/SPEC-mcp.md` §9.2) et se construisent avec sa tranche T2 (`affaires`) — §6 ci-dessous.

## 1. Le besoin

Une affaire avance par des échanges : un appel de découverte, une réunion de cadrage, une visio de démonstration.
Aujourd'hui, ils ne laissent de trace que dans un commentaire libre, sans type, sans date propre ni participants. La
« prochaine action » (`CRM-061`) dit ce qui **vient** ; rien ne dit ce qui **a eu lieu**. `docs/SPEC-cards.md` §17
écarte explicitement l'agenda et renvoie les activités typées à cette unité.

## 2. Ce qui est consigné (décision 648, point 1)

**Une activité réalisée** : ce qui a eu lieu, jamais ce qui est prévu.

| Donnée | Règle |
|---|---|
| Type | `appel`, `reunion` ou `visio` — liste fermée |
| Survenue le | date et heure, obligatoires ; **jamais dans le futur** (une activité réalisée a eu lieu) — tolérance de 5 minutes pour l'horloge du poste |
| Durée | en minutes, facultative, de 1 à 1440 |
| Sujet | texte court, obligatoire, 1 à 200 caractères |
| Compte rendu | texte long, facultatif, 20 000 caractères au plus |
| Participants | **contacts liés à l'affaire** (`card_contacts`) et **membres de l'espace** ; zéro, un ou plusieurs |
| Auteur | la personne qui consigne, posée par la base (`auth.uid()`) |

**Ce qui n'en est pas** : aucune planification, aucun rappel, aucune récurrence ; l'action à venir reste la
« prochaine action » et son échéance, seul chemin de ce geste (`docs/SPEC-cards.md` §15 bis). **La durée ne compte pas
dans le temps passé** (décision 648, point 2) : la saisie de temps (`CRM-098`) reste le seul chemin du temps compté, et
l'écran le dit en une phrase sous le champ.

## 3. Le modèle

Deux tables, migration au prochain numéro libre au moment de l'écrire.

**`public.card_activities`** : `id`, `card_id`, `workspace_id` (dérivé de l'affaire par trigger, comme
`card_comments`), `type`, `survenue_le`, `duree_minutes`, `sujet`, `compte_rendu`, `author_id` (défaut `auth.uid()`),
`created_at`, `edited_at`, `deleted_at`, `deleted_by`. **Retirer une activité la vide en pierre tombale** — la règle des
commentaires (`docs/SPEC-cards.md` §13.4) : `deleted_at` posé, sujet et compte rendu effacés, participants retirés ; la
ligne reste, pour que le fil dise « Activité retirée » à sa place. Aucune suppression physique par un client.

**`public.card_activity_participants`** : `activity_id`, et **exactement un** de `contact_id` ou `profile_id`
(contrainte). Un trigger refuse un contact **non lié à l'affaire** et un profil **non membre de l'espace** de
l'affaire (`23514`, `participant_hors_affaire`). Cascade depuis l'activité.

**Politiques — comme un commentaire** (décision 648, point 4 ; `docs/SPEC-cards.md` §13) :

| Geste | Règle |
|---|---|
| lire | `app.can_read_card(card_id)` |
| consigner | `app.can_write_card(card_id)` et `author_id = auth.uid()` |
| corriger | l'auteur, s'il peut toujours écrire sur l'affaire |
| retirer | l'auteur, s'il peut toujours écrire sur l'affaire ; **ou un administrateur de l'espace** qui peut lire l'affaire — modération, qui retire sans pouvoir réécrire (le patron de `card_comments_moderation`, INC-072, décision 374) |

Les participants suivent leur activité : lus avec elle, écrits par qui peut corriger l'activité.

## 4. Ce qu'on en voit

- **Fiche d'une affaire, bloc « Activités »**, dans la colonne gauche après « Contacts » : la liste, la plus récente en
  tête — icône du type (Lucide : `Phone`, `Users`, `Video`), sujet, date et heure, durée, participants nommés ; le
  compte rendu se déplie. **« Consigner une activité »** ouvre un formulaire dans le flux (type, date et heure — par
  défaut maintenant —, durée, sujet, compte rendu, participants choisis parmi les contacts de l'affaire et les
  membres). Corriger et retirer sur la ligne, selon les droits ; retirer demande une confirmation sur la ligne. Les
  commandes suivent la capacité d'écrire sur l'affaire (`CRM-093`, `docs/DESIGN_SYSTEM.md` §5.59).
- **Timeline unifiée** : une **troisième source**, lue par sa propre requête et fusionnée en mémoire avec les
  événements et les commentaires (`docs/SPEC-cards.md` §14.10, décision 209) ; une famille de filtre « Activités ». Une
  activité retirée s'y lit « Activité retirée », sans contenu.
- **Aucun écran transverse** dans cette unité (pas de liste de toutes les activités) : à arbitrer plus tard si le
  besoin vient.
- **Design system** : une section nouvelle, écrite après lecture intégrale du document, avant le code de l'écran.

## 5. États et refus

États systématiques du bloc (`docs/DESIGN_SYSTEM.md` §5.8) : chargement, erreur avec reprise, vide (« Aucune activité
consignée sur cette affaire. »), succès annoncé. Refus traduits par un dictionnaire fermé : date future, sujet vide ou
trop long, durée hors bornes, participant hors de l'affaire, droit refusé, réseau, inconnu.

## 6. Le connecteur MCP (décision 648, point 3)

Famille **`affaires`**, trois outils inscrits au catalogue de `CRM-104` (`docs/SPEC-mcp.md` §9.2), construits avec sa
tranche T2 :

| Outil | Action | Ce qu'il fait |
|---|---|---|
| `crm_affaire_activites_lister` | `consulter` | les activités d'une affaire, les plus récentes en tête, retirées comprises en pierre tombale |
| `crm_affaire_activite_ajouter` | `ajouter` | consigne une activité réalisée — mêmes règles qu'à l'écran |
| `crm_affaire_activite_modifier` | `modifier` | corrige une activité dont la personne est l'auteur |

**Aucun outil de retrait** : retirer reste un geste d'écran. Le connecteur agit dans les droits de la personne et
dans la matrice ; la base refuse comme elle refuse à l'écran.

## 7. Preuves

- **pgTAP** : tables, contraintes (type, date future, bornes), trigger des participants, politiques par profil
  (administrateur, business developer, lectrice, auteur et non-auteur, modération), pierre tombale.
- **API** aux jetons réels : consigner, corriger, retirer par l'auteur ; refus d'un non-auteur, d'une lectrice sans
  droit d'écrire, d'un participant hors de l'affaire.
- **Unitaires** : la lecture, la fusion dans la timeline, le formulaire, les refus traduits, les capacités.
- **E2E** : consigner au clavier, corriger, retirer avec confirmation ; la timeline la montre ; la lectrice ne voit
  que des commandes éteintes ; captures aux quatre paliers.
- **Seed** : une activité de chaque type sur les affaires de démonstration, créées par l'API comme à l'écran, dont une
  retirée.
- **Manuel** : un chapitre « Les activités d'une affaire ».

## 8. Tranches

| Tranche | Contenu |
|---|---|
| T1 | Migration (tables, contraintes, trigger, politiques), pgTAP, API, contrat de déploiement |
| T2 | Webapp : lecture, bloc « Activités », formulaire, timeline ; design system ; unitaires |
| T3 | E2E, captures, seed, manuel, campagnes |
| T4 | Outils MCP au catalogue de `CRM-104` (construits avec `CRM-104` T2) |
| T5 | Livraison en production, sur instruction du responsable |
