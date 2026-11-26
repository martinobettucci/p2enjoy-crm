# SPEC-couloirs — Les couloirs du board d'un channel (`CRM-130`)

*Écrite le 2026-11-26 par la session `p2enjoy-crm-dd`, **avant tout code** (`CLAUDE.md` §5, « Persistance immédiate des décisions »). Substance
validée par le responsable : décisions 860, 862, 863 et 864 (`docs/JOURNAL.md`) ; connecteur MCP : décision 861, point 2. Ce qui n'y est pas
tranché est posé au §13 comme **question au responsable**, avec la recommandation de la session ; aucune n'est résolue en silence.*

## 1. Ce que c'est, et ce que ce n'est pas

Un **couloir** (*swim lane*) regroupe visuellement des affaires **sur le board d'un channel**. Quand le CRM se remplira, un board de channel
deviendra illisible : les couloirs le découpent en bandes horizontales, chacune traversant les colonnes d'étapes.

- Un couloir est **purement visuel** : il ne porte aucune règle métier, aucun budget, aucune revue (hors périmètre explicite, décision 860). Il ne
  change ni l'étape d'une affaire, ni ses droits, ni ce que la RLS laisse lire ; il ne fait que **ranger** ce que le board montre déjà.
- **La vue liste n'a aucun couloir** (décision 860, point 3) : le couloir est une aide du **board du channel**, et de lui seul.
- **Le produit ne crée aucun couloir de lui-même** et ne propose **aucun découpage prédéfini** — ni par trimestre, ni par autre générateur
  (décision 862). Un channel sans couloir se rend exactement comme aujourd'hui.
- Un couloir est de l'une de **deux natures** :
  - **automatique** (`kind = 'rule'`) : une **règle** que la personne définit, dans le **moteur de filtres existant** (§3) ; il ne stocke que cette
    règle, et l'appartenance se **calcule** (décision 864, point 1) ;
  - **manuel** (`kind = 'manual'`) : une **sélection** d'affaires, faite à la main par des cases à cocher sous la vue ; il stocke ses affaires.

## 2. Où naît un couloir, et comment il s'importe

Un couloir a une **portée** (`scope`) :

| Portée | Naît… | Paraît… |
|---|---|---|
| `channel` | dans un channel | dans ce channel seulement |
| `track` | au niveau d'un track | dans les channels **de ce track** qui l'**importent** |
| `workspace` | au niveau de l'espace | dans les channels **de l'espace** qui l'**importent** |

- **Import** (décision 864, points 4 et 5) : dans un channel, on **choisit** un couloir de portée `track` ou `workspace`, et il **s'ajoute sous** les
  couloirs du channel. Un couloir importé est **unique et général** : l'import est un **lien**, jamais une copie ; **modifier le couloir le modifie pour
  tous les channels qui l'utilisent** (nom, règle, affaires d'un couloir manuel).
- **L'ordre des couloirs et leur état replié sont propres au channel**, gardés en base et **partagés** : replié pour quiconque ouvre le channel
  (décision 860). Un même couloir importé dans deux channels a donc deux rangs et deux états repliés indépendants.
- Ce qu'on **retire** d'un channel est le **lien** (le couloir importé disparaît de ce board, il reste défini ailleurs) ; ce qu'on **supprime** est le
  couloir lui-même (§13, question 5).

## 3. La règle d'un couloir automatique : le moteur de filtres existant

**Le moteur est celui des vues enregistrées** (`docs/SPEC-vues-import-export.md` §2.2, `app.saved_view_filters_valid`, `webapp/src/lib/liste-cards.ts`), dont
`public.export_cards` interprète déjà les filtres **en base**. La règle d'un couloir est un `jsonb` aux **clés fermées**, en anglais (`docs/DAT.md` §12 bis) :

| Clé | Valeur | Retient une affaire dont… |
|---|---|---|
| `step_id` | `uuid` d'une étape | le **rattachement** est à cette étape |
| `label_id` | `uuid` d'une étiquette de l'espace | l'affaire porte cette étiquette |
| `search` | texte, 200 caractères au plus | le texte de recherche de l'affaire contient ces termes (`search_tsv`, comme la vue liste) |
| `common_fields` | objet, 50 clés au plus, forme de `docs/SPEC-champs-communs.md` §8 | les champs communs correspondent (`app.card_common_filters_match`) |
| `time_zone` | nom IANA | le fuseau où se lit le jour d'un champ date et heure ; UTC par défaut |
| `inactive_for_days` | entier de 1 à 3650 | l'affaire est **froide** depuis au moins ce nombre de jours (**nouvelle clé**, §13 question 4) |

- **Les clés de tri et de sommeil de la vue liste (`sort`, `direction`, `snoozed`) n'existent pas dans une règle de couloir** : le tri est celui du board,
  et la visibilité des affaires en sommeil, archivées ou en corbeille est celle du board (§5.3) — un couloir ne la change pas. Une règle qui les porte
  est refusée en base.
- Une règle **vide** (`{}`) est refusée : elle retiendrait tout et ferait d'un couloir une copie du board. Au moins une clé est exigée.
- **Toutes les clés présentes s'ajoutent (ET).** Une règle qui veut « l'une ou l'autre » se fait avec deux couloirs et le départage du §5.1.
- **La clé nouvelle `inactive_for_days` répond à la demande du responsable** : « les affaires froides depuis plus de six mois » (décision 860). L'assistant la
  pose en jours (« six mois » ≈ 180 jours). **« Froide » est tranchée** (décision 1009, point 4) : le temps écoulé depuis le **dernier événement de l'affaire** (`card_events`, tout événement), à défaut depuis
  sa **création** ; la règle retient les affaires dont ce temps atteint `inactive_for_days` jours. Le calcul porte sur l'**affaire** : tous ses rattachements le suivent.
- Une règle **ne contourne jamais un droit** (même principe que `docs/SPEC-vues-import-export.md` §2.2) : elle ne fait que ranger des affaires que la personne lit déjà.

## 4. Le modèle de données

*Les noms sont en anglais, les textes et la documentation en français (`docs/DAT.md` §12 bis, décision 658).*

### 4.1 `public.lanes`

| Colonne | Règle |
|---|---|
| `id` | `uuid`, PK |
| `workspace_id` | `uuid`, non nul ; posé par déclencheur depuis le channel ou le track (jamais envoyé par le client) |
| `scope` | `text`, non nul : `channel`, `track` ou `workspace` |
| `channel_id` | `uuid` ; non nul **si et seulement si** `scope = 'channel'` ; FK composite `(channel_id, workspace_id)` → `channels`, `on delete cascade` |
| `track_id` | `uuid` ; non nul **si et seulement si** `scope = 'track'` ; FK composite → `tracks`, `on delete cascade` |
| `kind` | `text`, non nul : `rule` ou `manual` |
| `name` | `text`, non nul, 1 à 60 caractères après `app.btrim_blancs` |
| `rule` | `jsonb` ; non nul **si et seulement si** `kind = 'rule'` ; forme vérifiée par `app.lane_rule_valid(jsonb)` (§3) |
| `created_by` | `uuid`, FK `profiles` ; forcé à l'appelant par déclencheur |
| `created_at`, `updated_at` | `timestamptz` |

- **Unicité du nom**, sans casse ni blancs superflus : par `channel_id` pour la portée `channel`, par `track_id` pour `track`, par `workspace_id` pour
  `workspace`. Le refus est `23505`, rendu « Un couloir porte déjà ce nom ».
- **Aucun archivage** : un couloir se supprime (il ne porte aucune donnée métier ; le recréer est réversible). Un couloir **manuel** supprimé emporte ses
  affectations (`lane_members`), pas les affaires.
- **Ni la portée, ni la nature, ni le rattachement ne changent après la création** (déclencheur) : pour en changer, on crée un autre couloir.

### 4.2 `public.channel_lanes` — le lien, l'ordre et l'état replié, propres au channel

| Colonne | Règle |
|---|---|
| `channel_id`, `lane_id` | PK composite ; FK `on delete cascade` des deux côtés |
| `workspace_id` | `uuid`, non nul, posé par déclencheur |
| `position` | `numeric`, non nul : l'ordre des couloirs **dans ce channel**, de haut en bas |
| `collapsed` | `boolean`, non nul, `false` par défaut : replié **pour tout le monde** |

- Un couloir de portée `channel` reçoit sa ligne **à sa création** (déclencheur), en dernière position ; elle ne se retire qu'avec le couloir.
- Un couloir de portée `track` ne s'importe que dans un channel **de ce track** ; un couloir de portée `workspace`, dans un channel **de l'espace** ; le refus est
  en base (déclencheur), pas à l'écran.
- La position suit la règle du reste de l'application (`numeric`, insertion entre deux voisins sans renuméroter).

### 4.3 `public.lane_members` — les affaires d'un couloir manuel

| Colonne | Règle |
|---|---|
| `lane_id`, `placement_id` | PK composite ; FK → `lanes` (`on delete cascade`), `card_placements` (`on delete cascade`) |
| `workspace_id` | `uuid`, non nul, posé par déclencheur |
| `created_by`, `created_at` | qui a placé l'affaire, quand |

- **Le membre est le rattachement** (`card_placements`, une affaire dans un channel, `docs/SPEC-rattachements.md`), non l'affaire : une affaire rattachée à
  plusieurs channels est rangée **séparément** dans chacun (décision 860, point 2). Un couloir manuel **général** (portée `track` ou `workspace`) porte donc
  des rattachements de plusieurs channels, et chaque channel n'y voit que les siens.
- **Seul un couloir `manual` a des membres** (déclencheur).
- **Exclusivité dans un channel** (décision 864, point 2) : un rattachement est dans **un seul couloir manuel** parmi ceux que son channel porte. Insérer
  un membre dans un couloir **le retire**, dans la même instruction, de tout autre couloir manuel lié au channel du rattachement : « il quitte le premier et
  arrive dans le second ». Être dans deux couloirs manuels du même channel est **impossible** — l'invariant est tenu par la base, non par l'écran.
- **Un rattachement qui change de channel** (`move_card_to_channel`) perd tous ses membres : il repart sans couloir manuel dans son nouveau channel.
- Un rattachement archivé ou en corbeille **garde** ses membres : restauré, il retrouve son couloir.

## 5. Calcul de l'appartenance : en base, une seule réponse pour l'écran et le connecteur

**Décision 864, point 1 : « l'appartenance se calcule à l'affichage, en base ».** La session en tire la forme suivante, qui rend à l'écran et au connecteur
MCP **la même réponse** (`docs/JOURNAL.md` décision 863).

### 5.1 La règle de départage (décision 863)

Pour un rattachement `P` du channel `C`, parmi les couloirs liés à `C` :

1. si `P` est membre d'un couloir **manuel** de `C`, c'est **ce couloir** (il est unique, §4.3) — **le manuel prime** ;
2. sinon, c'est le **premier couloir automatique**, dans l'ordre de `channel_lanes.position`, dont la règle retient `P` ;
3. sinon, `P` est **hors couloir** : il reste **tout en haut** du board, avant le premier couloir (§6.2).

Un couloir **manuel** retenant `P` prime donc sur un automatique qui le retiendrait aussi, et **l'ordre** départage deux automatiques. Aucune
indication « aussi retenue par » n'existe (décision 864, point 3).

### 5.2 Les fonctions

*Noms en anglais ; `security invoker` : la RLS de la personne décide de ce qu'elle lit.*

- **`app.lane_rule_matches(p_placement uuid, p_rule jsonb) returns boolean`** — l'interprétation d'une règle pour un rattachement, avec **les mêmes prédicats**
  que `public.export_cards` (étape, étiquette, recherche, `app.card_common_filters_match`) et la clé `inactive_for_days`. Source **unique** : `export_cards` et
  les couloirs ne dupliquent pas la logique des filtres (T1 en reprend les prédicats sans changer leur sens).
- **`public.board_lanes(p_channel uuid)`** — rend les couloirs du channel, dans l'ordre : `lane_id`, `name`, `kind`, `scope`, `position`, `collapsed`,
  `is_imported`, `channel_count` (les channels qui l'utilisent), `member_count` (les rattachements du channel qu'il retient). Un channel illisible et un channel
  inexistant se confondent (`404 channel_not_found`, comme `export_cards`).
- **`public.board_lane_assignment(p_channel uuid)`** — rend `(placement_id, lane_id)` pour **chaque rattachement actif du channel** (`lane_id` nul = hors couloir),
  par la règle du §5.1.
- **`public.lane_rule_preview(p_channel uuid, p_rule jsonb)`** — le nombre de rattachements du channel qu'une règle retiendrait, pour l'aperçu du formulaire
  (§7.3) ; refuse une règle invalide (`22023 invalid_rule`).
- **Écritures** (fonctions, pas `PATCH` direct, parce qu'elles tiennent des invariants que plusieurs lignes portent) :
  `public.lane_create(...)`, `public.lane_update(p_lane, ...)`, `public.lane_delete(p_lane)`, `public.lane_import(p_channel, p_lane)`,
  `public.lane_unlink(p_channel, p_lane)`, `public.lane_reorder(p_channel, p_lane, p_after)`, `public.lane_set_collapsed(p_channel, p_lane, p_collapsed)`,
  `public.lane_place(p_lane, p_placements uuid[])` (l'exclusivité du §4.3), `public.lane_unplace(p_placements uuid[])`.

### 5.3 Ce que le board lit, et ce qu'il ne change pas

**Révise `docs/SPEC-workflow-engine.md` §7.2** : le board lit **deux requêtes de plus**, émises **en parallèle** des quatre existantes (n° 5 et 6) — `board_lanes(channel)`
et `board_lane_assignment(channel)` — ; un channel sans couloir les rend vides et le board **se rend exactement comme avant**. Le contenu de chaque carte, les
colonnes, le glisser-déposer d'étape, les transitions atteignables et les refus (`docs/SPEC-workflow-engine.md` §7.4 à §7.10) sont **inchangés** : un couloir ne
décide ni de ce qu'une carte montre, ni de ce qu'elle peut faire. **Les affaires archivées, en corbeille ou en sommeil gardent la visibilité qu'elles ont sur
le board aujourd'hui**, couloir ou pas.

## 6. Le board avec des couloirs

*Les règles visuelles s'inscrivent dans `docs/DESIGN_SYSTEM.md` (nouvelle section, écrite avec le code de la tranche T2) ; ce qui suit dit **ce que l'écran fait**.*

### 6.1 Composition

- Les **colonnes** restent celles des étapes du workflow du channel (§7.3 du moteur), leur **en-tête collant** reste **unique** en haut du board. Chaque couloir est une
  **bande horizontale** qui **traverse les colonnes** : dans la bande, chaque colonne n'affiche que les cartes de ce couloir **à cette étape**.
- L'**en-tête d'une bande** porte : un bouton **replier / déplier** (`aria-expanded`, `aria-controls`), le **nom** du couloir, le **nombre d'affaires** qu'il retient,
  l'indication de sa **nature** (icône Lucide : `Filter` pour une règle, `ListChecks` pour une sélection) et celle de son **import** (`Link2`) lorsqu'il est général,
  et un **menu d'actions** (§7). Une bande **repliée** ne montre que son en-tête.
- Le **compteur** et le **montant cumulé** d'une colonne, dans l'en-tête collant, restent ceux de **toute la colonne** (toutes bandes confondues) ; chaque bande
  affiche son propre nombre d'affaires.

### 6.2 Hors couloir, tout en haut

Les affaires qu'aucun couloir ne retient forment la **première bande**, intitulée « Hors couloir », **au-dessus** du premier couloir (décision 863, point 2). Elle
**n'existe que si** le channel porte au moins un couloir **et** qu'au moins une affaire est hors couloir ; elle **ne se replie pas** et n'est pas un couloir (aucune
action ne la touche).

### 6.3 États, responsive, accessibilité

- **États** : chargement des couloirs (la bande se réserve sa place, aucun saut), **erreur** de lecture des couloirs (le board **reste utilisable sans couloirs**, avec un
  bandeau « Les couloirs n'ont pas pu être lus » et un bouton « Réessayer » — un défaut de couloirs ne prive jamais du board), couloir **vide** (« Aucune affaire
  dans ce couloir » ; pour un couloir manuel, l'action « Ajouter des affaires »), absence de couloir (le board d'avant).
- **Quatre paliers** (`docs/DESIGN_SYSTEM.md` §7) : sous le palier large, le board défile **dans son conteneur** (comme aujourd'hui) et l'en-tête d'une bande **reste visible à
  gauche** (collant horizontalement) ; aucun contenu n'est tronqué sans signe.
- **Clavier** : l'en-tête de bande est un bouton atteignable à la tabulation ; Entrée et Espace replient ; les actions de menu (§7) sont atteignables au clavier ; **réordonner**
  se fait par « Monter » et « Descendre » dans le menu (jamais par le seul glisser-déposer). Le **focus** est visible ; un changement d'état annonce (`role="status"`) « Couloir
  replié » / « Couloir déplié ».
- **Replier est un geste partagé** (§13, question 2) : il s'écrit en base (`lane_set_collapsed`) ; une personne qui ne peut pas l'écrire peut déplier **pour sa session**
  (`sessionStorage`, `CLAUDE.md` §11, catégorie 2), sans toucher à l'état partagé.
- **Aucun couloir n'est une cible de dépôt** : on ne glisse pas une carte « dans » un couloir (le rangement d'une affaire à la main passe par la sélection, §7.4). Glisser une carte
  vers une autre colonne reste un déplacement d'étape ; la carte paraît ensuite dans le couloir que ses nouveaux attributs lui donnent.

## 7. Créer, modifier, ranger : les gestes de l'écran

### 7.1 Le menu du board

Dans la barre du board : **« Couloirs »** ▸ « Nouveau couloir… » · « Importer un couloir… ». Sur l'en-tête d'une bande : **menu** ▸ « Modifier », « Monter »,
« Descendre », « Retirer de ce channel » (couloir importé) ou « Supprimer » (couloir de ce channel), « Ajouter des affaires » (couloir manuel).

### 7.2 Un couloir automatique

« Nouveau couloir » ▸ « Par règle » : un **nom** et le **formulaire de la règle**, qui **réemploie les contrôles de filtres de la vue liste** (étape, étiquette, recherche, champs
communs) et ajoute « Sans activité depuis … jours ». Un **aperçu** dit combien d'affaires **de ce channel** la règle retient (`lane_rule_preview`) avant d'enregistrer ; le formulaire
refuse une règle vide avec son motif. Créer sur le **track** ou l'**espace** (portée générale) est un choix du même formulaire.

### 7.3 Un couloir manuel

« Nouveau couloir » ▸ « Par sélection » ouvre le **mode sélection** : une **case à cocher** apparaît **sous la carte** de chaque affaire du board (« cases à cocher sous la vue »,
décision 860), une barre fixe dit « N affaires sélectionnées », porte le champ **nom** et **« Créer le couloir »**. Le même mode sert « Ajouter des affaires » à un couloir existant
et « Sortir du couloir » (`lane_unplace`). L'exclusivité est dite avant le geste lorsqu'elle s'applique : « 2 de ces affaires quitteront leur couloir actuel ».

### 7.4 L'import

« Importer un couloir… » liste les couloirs de portée `track` (de ce track) et `workspace` **pas encore liés** à ce channel, avec leur nature et le nombre de channels qui les
utilisent. L'import s'ajoute **sous** les couloirs du channel. Si le couloir est manuel et que certains de ses membres sont déjà dans un autre couloir manuel de ce channel, le geste
est **refusé** (décision 1009, point 1), avec le nombre d'affaires en conflit.

### 7.5 Droits

La règle est **en base** (`CLAUDE.md` §10) ; l'écran n'en est que le miroir (commandes éteintes avec leur motif, jamais le seul garde). Voir le §8 et les questions 2 et 3 du §13.

## 8. Qui lit, qui écrit — en base

*Réponses du responsable du 2026-11-26 (décision 1009, points 2, 3 et 5) : toutes les recommandations sont retenues ; la dernière colonne dit ce que la base applique.*

| Geste | Règle (RLS et fonctions) | Réponse du responsable |
|---|---|---|
| lire les couloirs d'un channel | tout membre qui lit le channel (`app.can_read_channel`) | — (ferme) |
| lire le catalogue d'import d'un track / de l'espace | qui lit le track (`app.can_read_track`) / tout membre de l'espace | — (ferme) |
| créer, modifier, supprimer un couloir de portée `track` ou `workspace` | **administrateur de l'espace** (`app.is_workspace_admin`) | ferme : un couloir général touche plusieurs channels |
| créer, modifier, supprimer, importer, réordonner un couloir de portée `channel` | **l'administrateur de l'espace** (`app.is_workspace_admin`) **ou** qui écrit les affaires du channel (`app.can_write_channel`) | retenu (point 3) |
| placer / sortir une affaire d'un couloir manuel | qui **écrit l'affaire** (`app.can_write_card`) ; le geste ne touche que le rattachement de cette affaire | — |
| replier / déplier (état partagé) | qui écrit les affaires du channel (`app.can_write_channel`) ; un lecteur déplie pour sa seule session | retenu (point 2) |

Privilèges explicites (`revoke all` puis `grant`), **aucun pour `anon`**. Les écritures passent par les fonctions du §5.2 ; `select` seul est ouvert en lecture directe. **Preuves de refus** par
requête directe, jetons réels : un lecteur qui crée, un business developer qui crée un couloir de portée `workspace`, une personne d'un autre espace qui lit ou importe, un import dans un
channel d'un autre track.

## 9. Le connecteur MCP — famille existante `structure` (décision 861, point 2)

**Question 1 du `CLAUDE.md` : oui** — le connecteur **voit** les couloirs existants et **aide à les créer** (exemple du responsable : « fais-moi, dans tel track, tel channel, un couloir de toutes
les affaires froides depuis plus de six mois »). **Question 2 : famille existante `structure`**, actions `consulter`, `ajouter`, `modifier`, `supprimer` ; **aucune migration de la liste fermée**
(`docs/SPEC-mcp.md` §6.1, §7.1). Les outils s'inscrivent à `docs/SPEC-mcp.md` §9.2 (tranche dédiée, `CRM-104` étant livrée) :

| Outil | Action | Ce qu'il appelle |
|---|---|---|
| `crm_lane_list` | `consulter` | `board_lanes`, `board_lane_assignment` — les couloirs d'un channel, leur règle traduite en clair, leurs effectifs |
| `crm_lane_rule_preview` | `consulter` | `lane_rule_preview` — combien d'affaires une règle retiendrait, avant de créer |
| `crm_lane_create` | `ajouter` | `lane_create` (règle, ou liste d'affaires pour un manuel) |
| `crm_lane_import` | `ajouter` | `lane_import` |
| `crm_lane_update` | `modifier` | `lane_update`, `lane_place`, `lane_unplace`, `lane_reorder` |
| `crm_lane_delete` | `supprimer`, `destructiveHint` | `lane_delete`, `lane_unlink` |

La **base refuse** ce que la matrice ouvrirait à tort (§8) ; l'outil traduit le refus. Le connecteur **ne replie pas** un couloir (un état d'écran partagé). **Dépendance** : l'unité `INC-286`
lot 1 (le connecteur en anglais) touche les mêmes fichiers ; la tranche T5 s'écrit **après** son livraison, pour poser les noms définitifs une seule fois.

## 10. Le seed, le manuel et le design system

- **Seed** (`CLAUDE.md` §8 ; une nouvelle section de `docs/SPEC-seed.md`) : le jeu démontre chaque nature et chaque geste **dans un channel que les preuves existantes du board n'emploient pas**
  (le board de `grands-comptes` sert `scripts/verify-board.sh` et plusieurs E2E : des couloirs y changeraient leurs captures et leurs comptages) — un couloir par règle (étape), un manuel (deux
  affaires), un couloir de track importé dans un second channel du même track, un couloir replié, et au moins une affaire hors couloir. Créés **par les fonctions du §5.2**, comme l'application les emploie.
- **Manuel** (`docs/manual.md`, `docs/SPEC-manual.md`) : une section du chapitre du board — qu'est un couloir, par règle ou par sélection, importer, replier, l'exclusivité, ce qu'un couloir ne fait pas ;
  captures renouvelées aux quatre paliers.
- **Design system** (`docs/DESIGN_SYSTEM.md`, section nouvelle, écrite avec la tranche T2) : la bande, son en-tête, l'état replié, « Hors couloir », la barre du mode sélection, les icônes, les jetons
  (aucune couleur nouvelle : couleurs de la charte, jamais seules à porter l'information), les textes `lanes.*` centralisés (`docs/DAT.md` §23), un texte long pour l'essai de débordement.

## 11. Tranches, et ce que chacune livre

| Tranche | Contenu | Preuves |
|---|---|---|
| **T1** | Migration (tables, contraintes, déclencheurs, RLS, fonctions du §5.2), types régénérés | pgTAP (invariants, exclusivité, portées, refus par requête directe), API |
| **T2** | Le board lit et rend les couloirs ; repli partagé ; « Hors couloir » ; états | unitaires, E2E souris et clavier, captures aux quatre paliers, DS |
| **T3** | Créer, modifier, supprimer, importer, réordonner ; mode sélection ; aperçu de règle | unitaires, E2E souris et clavier, refus d'autorisation directs |
| **T4** | Seed, manuel, DS, textes ; harnais (`verify-couloirs.sh`) | seed démontre chaque geste ; `verify-manual` |
| **T5** | Outils MCP (après `INC-286` lot 1) | tests MCP contre un vrai client ; matrice ; refus par la base |

**Definition of Done de l'unité** : toutes les tranches ; unitaires, pgTAP, API et E2E propres à chaque tranche ; refus d'autorisation par requête directe ; captures aux quatre paliers observées ;
seed ; manuel ; DS ; changelog `[Non publié]` ; contrat de déploiement (migration à appliquer) ; backlog à l'état réel.

## 12. Ce que `CRM-130` ne fait pas

La **vue liste** n'a aucun couloir. Aucune **revue**, aucun **sous-budget**, aucune règle métier par couloir. Aucun couloir **créé par le produit** (trimestre ou autre générateur). Aucune indication
« **aussi retenue par** » sur la carte. Aucun **glisser-déposer vers un couloir**. Aucune **règle « l'un ou l'autre »** dans un seul couloir. Aucun couloir sur l'écran « Ma journée » ou le carnet.

## 13. Réponses du responsable — décision 1009 (2026-11-26) : toutes les recommandations de la session sont retenues

*Les six questions posées par la session le 2026-11-26 (décision 1007) sont répondues ; **le code est débloqué**. Les réponses sont reprises dans le corps de la spécification (§3, §4.3, §5.3, §7.4, §8).*

1. **Import d'un couloir manuel dont des membres sont déjà dans un autre couloir manuel du channel** : l'import est **refusé**, et le message nomme le nombre d'affaires en conflit (l'exclusivité du §4.3 interdit de les mettre dans deux couloirs).
2. **Qui replie ou déplie pour tout le monde** : qui écrit les affaires du channel ; un lecteur déplie pour sa seule session (`sessionStorage`).
3. **Qui crée, modifie, supprime un couloir de portée `channel`** : l'administrateur de l'espace **ou** qui écrit les affaires du channel ; les portées `track` et `workspace` restent réservées à l'administrateur.
4. **Une affaire « froide »** : le temps depuis son **dernier événement** (`card_events`), à défaut depuis sa **création** (§3).
5. **Supprimer un couloir général encore utilisé ailleurs** : l'administrateur seul, **après une confirmation qui nomme le nombre de channels** qui l'emploient ; le simple retrait d'un channel reste un geste à part.
6. **Visibilité** : un couloir **ne change rien** à ce que le board montre (sommeil, archive, corbeille inchangés ; §5.3).

**Connecteur MCP** (`CLAUDE.md`, « Toute fonctionnalité pose la question du connecteur MCP ») : **les deux questions sont répondues** (décision 861, point 2) — oui, famille existante `structure` (§9).
