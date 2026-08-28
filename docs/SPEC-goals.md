# Tableau d'objectifs — le « tableau blanc intelligent »

Spécification écrite **avant tout code**, sur décision du responsable du 2026-08-19
(`docs/JOURNAL.md`, décision 431). Unités porteuses : `CRM-082` (modèle, RLS, API) et
`CRM-083` (canevas et liens).

## 1. Ce que c'est, et surtout ce que ce n'est pas

Un **tableau d'objectifs** est une surface de composition libre — une *lavagna* — sur laquelle
l'utilisateur pose des **blocs**, les relie par des **flèches**, et indique **à la main** où
chacun en est. Un bloc peut pointer un **channel** ; le clic y mène.

**Ce n'est pas une projection des données du CRM.** C'est le point le plus important de cette
spécification, et il est écrit en tête parce qu'il commande tout le reste :

| Interdit, sans exception | Pourquoi |
|---|---|
| **Calculer** le remplissage d'un bloc à partir des cards du channel lié | L'utilisateur décide de ce qu'« avancé à 60 % » signifie pour SON objectif ; aucune formule ne le sait |
| **Créer un lien automatiquement** entre deux blocs | Un diagramme est un raisonnement, pas une dérivation du schéma |
| **Créer, déplacer ou supprimer un bloc** en réaction à un événement du CRM | Le tableau ne bouge que quand une personne le bouge |
| **Déduire un ordre, un chemin critique, un pourcentage global** | Le produit n'a pas d'opinion sur le diagramme d'autrui |

Le seul lien avec le reste du produit est **descendant et volontaire** : un bloc *peut* désigner un
channel, et ce lien sert exclusivement à naviguer et à appliquer la règle de visibilité du §4.

**Corollaire, à opposer à toute demande d'évolution :** si une fonctionnalité future propose de
remplir un bloc « automatiquement à partir de l'avancement réel », elle contredit cette
spécification et doit être arbitrée comme un changement de nature, pas comme une amélioration.

## 2. Objets

### 2.1 `goal_boards` — le tableau

Un tableau appartient à un **workspace**, jamais à un track : un bloc peut viser un channel de
n'importe quel track, et un tableau transverse — « mes objectifs du trimestre » — doit rester
possible. Arbitrage du responsable du 2026-08-19.

| Attribut | Règle |
|---|---|
| `name` | non vide, unique par workspace après normalisation des espaces, **archivés compris** (§2.1 bis) |
| `description` | facultative |
| `position` | ordre d'affichage dans la liste, attribuée par trigger si omise, comme `tracks.position` |
| `archived_at` | l'archivage tient lieu de suppression, comme pour les tracks et les channels |

### 2.1 bis L'unicité du nom porte AUSSI sur les tableaux archivés — arbitrage rendu

**Tranché le 2026-08-28** (`docs/JOURNAL.md`, décision 542), sur le mandat d'autonomie du
`docs/CloudWorker.md` §4.1 bis. Cette section REMPLACE le silence de la première rédaction, qui
écrivait « unique par workspace sur la forme normalisée » sans dire si les tableaux archivés
comptaient. Ce silence était l'entrée **INC-168** du registre, ouverte depuis le 2026-08-19 ; elle
est close ici.

**La règle, en une phrase :** un tableau archivé **retient son nom**. L'index
`goal_boards_workspace_name_key` est TOTAL, sans clause `where archived_at is null`, et un nom
libéré par l'archivage reste donc pris.

#### 2.1 bis.1 Les trois mesures qui fondent l'arbitrage

Relevées le **2026-08-28** sur la pile de développement seedée, par la **vraie route REST** avec le
jeton réel de l'administratrice, et au catalogue pour la troisième. Aucune n'est déduite.

| # | Mesure | Relevé |
|---|---|---|
| 1 | `POST goal_boards` reprenant le nom d'un tableau que l'on vient d'archiver | `409` / `23505`, `goal_boards_workspace_name_key` |
| 2 | **Le même geste sur un TRACK** : archiver, puis reprendre son `slug` | `409` / `23505`, `tracks_workspace_id_slug_key` — **le produit se comporte déjà ainsi** |
| 3 | `pg_index` sur `goal_boards`, `tracks`, `channels` et `budgets` | `indpred` **nul** pour les trois premiers ; **`(closed_at IS NULL)`** pour `budgets_track_name_ouvert_key`, seul index partiel des quatre |

**La mesure 2 décide, et c'est elle qui retourne la question.** Le registre présentait l'écart comme
« deux objets voisins, spécifiés le même jour, reçoivent deux règles opposées », et invitait à croire
que l'un des deux était un oubli. Le dépôt en porte un **troisième**, plus ancien et jamais discuté :
les tracks et les channels, dont l'archivage tient lieu de suppression **exactement comme celui d'un
tableau**, retiennent leur identifiant. Le tableau d'objectifs n'est donc pas l'exception — le budget
l'est.

#### 2.1 bis.2 Pourquoi la règle des tracks, et non celle des budgets

C'est la ligne du responsable, « le comportement le plus simple, et le même partout » : deux objets
qui font la même chose la font de la même façon. Or **archiver** et **clôturer** ne sont pas la même
chose, et c'est ce qui sépare proprement les deux règles.

| | Tracks, channels, tableaux d'objectifs | Budgets |
|---|---|---|
| Le geste | **archiver** — un masquage réversible qui tient lieu de suppression | **clôturer** — un état terminal d'une période comptable |
| L'objet après le geste | il est encore là, et se **reprend** (`Désarchiver`, §5.6) | il est **soldé** ; sa réouverture est un geste exceptionnel |
| Le nom | **retenu** | **libéré**, parce qu'un budget récurrent reprend le même nom d'une période à l'autre |
| Reprendre l'objet peut-il échouer sur un doublon ? | **jamais** (§5.6.1, mesure 6) | **oui**, et `docs/SCHEMA.md` §9 bis.4 l'assume explicitement |

**La dernière ligne est le vrai motif.** Depuis la tranche 2 h, un tableau archivé se **désarchive**
(§5.6). Libérer son nom rendrait ce retour faillible : le nom repris entre-temps par un tableau
neuf, « Désarchiver » se heurterait à un doublon **que rien dans l'écran n'aurait annoncé**, sur un
geste qui ne détruit rien et s'exécute sans confirmation (§5.6.2, ligne f). Ce serait exactement la
perte silencieuse que `CLAUDE.md` §18 proscrit. L'unicité totale l'interdit **par construction**, et
c'est pourquoi le dictionnaire de refus du désarchivage n'a aucun cas `doublon` à porter.

#### 2.1 bis.3 Ce que cette règle coûte, et ce qui l'a rendue tenable

Elle coûte ceci, et le coût est nommé plutôt que tu : **un nom que l'on croit libre ne l'est pas
toujours**. Archiver « Objectifs du trimestre » puis vouloir en ouvrir un neuf sous le même nom
échoue.

Ce coût était **inacceptable jusqu'au 2026-08-28 au matin**, et c'est ce qui a tenu l'arbitrage
ouvert six sessions : le nom était alors retenu par un objet **qu'aucun écran ne rendait**. On
cherchait dans la liste un tableau qui n'y paraissait pas. La tranche 2 h a refermé ce point
(§5.6) : la case « Afficher les archivés » rend le tableau qui bloque, et « Désarchiver » le rend
administrable. Le nom est encore pris, mais il est désormais **pris par quelque chose que l'on
voit et que l'on peut reprendre ou renommer**. Un refus qui désigne un objet atteignable est un
refus ordinaire ; c'est l'inatteignabilité, et non la règle, qui en faisait un défaut.

Le refus le dit donc, et il dit le geste : le texte de `goals.board.refused.duplicate` nomme la
case « Afficher les archivés » comme la voie de recours (§5.6.2), au lieu de s'arrêter à « choisissez
un autre nom ».

#### 2.1 bis.4 Ce que l'arbitrage NE change pas

- **Aucune migration.** L'index `0049` est déjà celui que cette section décrit ; la décision retient
  le comportement en place et l'ÉCRIT, elle ne le modifie pas.
- **Aucune politique, aucun privilège, aucune route.**
- **La règle des budgets est inchangée** (`docs/SCHEMA.md` §9 bis.4) : l'écart entre les deux index
  est désormais **voulu et motivé**, non plus un oubli de rédaction supposé.
- **Aucun renommage automatique, aucun suffixe suggéré.** Proposer « Objectifs du trimestre (2) »
  écrirait à la place de l'utilisateur un nom qu'il n'a pas choisi.

### 2.2 `goal_blocks` — le bloc

| Attribut | Règle |
|---|---|
| `board_id` | non nul |
| `title` | non vide |
| `body` | facultatif, texte libre |
| `fill_percent` | entier `0..100`, défaut `0`, **saisi à la main et jamais calculé** |
| `channel_id` | **facultatif** — le lien vers un channel ; `on delete set null` |
| `pos_x`, `pos_y` | `numeric`, position sur le canevas |
| `width`, `height` | `numeric`, taille du bloc |
| `color` | nom de jeton (`brand`, `success`, `accent`, `danger`, `neutral`), jamais un hexadécimal — `docs/DESIGN_SYSTEM.md` §1 |

**`fill_percent` est un entier, pas une fraction.** Un pourcentage saisi à la main se lit et se
compare mieux en entiers ; la précision décimale suggérerait un calcul, ce que le §1 interdit.

**Le lien vers le channel est `set null` à la suppression, pas `cascade`.** Un channel mis à la
corbeille ne doit pas faire disparaître un objectif : le bloc survit, son lien tombe, et l'écran
dit que la destination n'existe plus (§5.4). Détruire le raisonnement d'un utilisateur parce
qu'une destination a bougé serait une perte de donnée.

### 2.3 `goal_links` — la flèche

| Attribut | Règle |
|---|---|
| `board_id` | non nul, **redondant avec les blocs et c'est délibéré** (§2.4) |
| `source_block_id`, `target_block_id` | non nuls, `on delete cascade` |
| `direction` | `'forward'` (`->`), `'backward'` (`<-`), `'both'` (`<->`) |
| `label` | facultatif, mot posé sur la flèche |

**Trois directions et non deux, alors que `<-` est le symétrique de `->`.** Stocker `<-` en
inversant source et cible ferait « sauter » la flèche au rechargement, dans l'autre sens que celui
où l'utilisateur l'a tracée. Un tableau blanc restitue exactement le geste : la direction est donc
une donnée, pas une normalisation.

**Contraintes.** `source_block_id <> target_block_id` — une flèche d'un bloc vers lui-même n'a pas
de sens de lecture. Unicité sur `(source_block_id, target_block_id)` : deux flèches entre les mêmes
blocs se superposeraient sans se distinguer ; changer la direction d'une flèche existante est une
modification, pas un ajout.

**Aucun refus de cycle.** Un diagramme d'objectifs n'est pas un graphe acyclique : « A nourrit B,
B nourrit A » est une intention légitime. Le produit ne détecte ni ne refuse les cycles.

### 2.4 Pourquoi `goal_links.board_id` est redondant

Le tableau d'un lien se déduit de ses blocs. La colonne existe quand même, avec un trigger qui
refuse un lien dont les deux blocs n'appartiennent pas à ce tableau. Deux raisons, la seconde
étant la vraie :

1. la politique de lecture d'un lien se résout **sans jointure** sur les blocs ;
2. elle rend **impossible** un lien entre deux tableaux, qui ne se détecterait autrement qu'à
   l'affichage — le même raisonnement que la cohérence workflow ↔ channel de `CRM-033`.

## 3. Ce que l'utilisateur fait

| Geste | Règle |
|---|---|
| Créer un tableau, le renommer, le réordonner, l'archiver | §4 |
| Poser un bloc sur le canevas | position issue du geste, jamais d'un placement automatique |
| Déplacer, redimensionner un bloc | persiste `pos_x`, `pos_y`, `width`, `height` |
| Saisir le titre, le corps, la couleur | — |
| Régler le remplissage | curseur **et** champ numérique ; les deux écrivent la même valeur |
| Lier le bloc à un channel | sélecteur des channels **lisibles** par l'appelant, groupés par track |
| Retirer le lien | remet `channel_id` à nul |
| Tracer une flèche entre deux blocs | choix de la direction à la création, modifiable ensuite |
| Supprimer une flèche, supprimer un bloc | la suppression d'un bloc emporte ses flèches (`cascade`) |
| **Ouvrir le channel d'un bloc** | navigation vers `/tracks/:slugTrack/:slugChannel` |

**Un bloc se supprime réellement, il ne s'archive pas.** Contrairement aux tracks et aux channels,
un bloc ne porte aucune donnée métier et n'est référencé par rien d'autre que ses flèches. Le
tableau, lui, s'archive : il contient le travail.

## 4. Autorisations

**Arbitrage du responsable, 2026-08-19.** La lecture suit la règle des tracks ; l'**écriture** est
ouverte à tout membre pouvant écrire, parce qu'« un utilisateur crée autant d'objectifs qu'il
veut » suppose qu'il n'ait pas à demander un administrateur. La lavagna est un outil de travail,
pas une configuration.

### 4.1 Lecture

| Objet | Lisible lorsque |
|---|---|
| `goal_boards` | l'appelant est membre du workspace |
| `goal_blocks` — bloc **sans** `channel_id` | l'appelant lit son tableau |
| `goal_blocks` — bloc **avec** `channel_id` | l'appelant lit son tableau **et** `app.can_read_channel(channel_id)` |
| `goal_links` | l'appelant lit son tableau |

**Un bloc lié à un channel fermé est invisible, et ses flèches restent.** C'est le seul choix qui
ne fuit pas : rendre le bloc en le grisant révélerait qu'un objectif existe sur un channel
interdit, et son titre en dirait déjà trop. Les flèches qui y menaient pendent alors dans le vide
— l'écran les rend comme des flèches vers un bloc absent (§5.4), sans jamais nommer ce qui manque.

**Ce que cela coûte, et qui est assumé :** deux personnes du même workspace peuvent voir deux
diagrammes différents du même tableau. C'est la conséquence directe de « même RLS que les
tracks », et elle est correcte : la confidentialité prime sur la complétude du dessin.

### 4.2 Écriture

| Objet | Écriture autorisée à |
|---|---|
| `goal_boards` | **tout membre du workspace** — créer, renommer, réordonner, archiver |
| `goal_blocks` — bloc sans lien | tout membre du workspace |
| `goal_blocks` — bloc avec `channel_id` | `app.can_write_channel(channel_id)` — **poser le lien exige le droit d'écrire dans la destination** |
| `goal_links` | tout membre pouvant écrire les deux blocs qu'elle relie |

**Un `viewer` n'écrit rien**, tableau libre compris. C'est l'invariant du §2.1 de
`docs/SPEC-permissions-rls.md` — « consulte, sans aucune écriture » —, et aucune table n'est
autorisée à le percer.

**Poser un lien exige l'écriture sur le channel, pas seulement sa lecture.** Un lien est une
affirmation publique — « cet objectif porte sur ce dossier » — que verront tous ceux qui lisent le
channel. Quelqu'un qui n'a que la lecture ne peut pas engager le dossier d'autrui. Retirer le lien
n'exige rien de plus que l'écriture sur le bloc : on peut toujours défaire ce qui gêne.

**Aucune notion de propriétaire de bloc.** Un diagramme est un objet collectif : si l'on ne peut
pas déplacer le bloc d'un collègue pour rendre le schéma lisible, la lavagna partagée ne
fonctionne pas. `created_by` est conservé pour la trace, jamais pour le droit.

## 5. Écran

Détail visuel : `docs/DESIGN_SYSTEM.md` §5.29.

### 5.1 Liste des tableaux

Entrée de navigation **« Objectifs »**, au même niveau que la messagerie. Liste des tableaux non
archivés, avec leur nom, leur description et le nombre de blocs **lisibles par l'appelant**.

**RÉVISÉ le 2026-08-28, tranche 2 h.** « Non archivés » reste le comportement **par défaut**, mais il
n'est plus le seul : une case **« Afficher les archivés »** élargit la liste à ceux qui le sont, et
leur rend la commande **« Désarchiver »**. Le §5.6 porte le contrat, ses mesures et ses écarts.

### 5.2 Canevas

Zone pannable et zoomable. Chaque bloc est une carte à coins arrondis portant son titre, un extrait
du corps, sa couleur de jeton en liseré gauche, sa jauge de remplissage, et — s'il est lié — une
pilule de channel au format « Track › Channel ».

La jauge emploie `--color-brand` sur `--color-brand-soft`. **Elle ne change pas de couleur avec la
valeur** : un remplissage saisi à la main n'est ni bon ni mauvais, et le vert ou le rouge y
introduiraient un jugement que le produit n'a pas à porter.

### 5.3 Flèches

Tracées entre les bords des blocs, avec une pointe à chaque extrémité concernée par la direction.
Le libellé, s'il existe, se pose au milieu sur un fond `--color-surface`.

### 5.4 États

| État | Rendu |
|---|---|
| Tableau vide | « Aucun objectif sur ce tableau », et l'action d'en poser un |
| Aucun tableau | « Aucun tableau d'objectifs », et l'action d'en créer un |
| Bloc lié à un channel **devenu illisible** | le bloc n'est pas rendu ; ses flèches sont rendues **en pointillés vers le vide**, sans libellé et sans infobulle — l'écran ne nomme jamais ce qu'il cache |
| Bloc lié à un channel **supprimé** (`channel_id` devenu nul) | le bloc est rendu sans pilule, et une mention « lien perdu » invite à en reposer un |
| Lecture seule | tous les gestes d'écriture du canevas sont **indisponibles et lisibles**, et l'écran dit pourquoi — `docs/DESIGN_SYSTEM.md` §8. **RÉVISÉ le 2026-08-28, tranche 3** : l'état ne se déduit plus du RÔLE `viewer` mais de la **capacité que la base consent**, `public.ecriture_permise(goal_boards)`. Le §5.7 porte le contrat, ses quatre mesures et ce qu'il ne recouvre pas |
| Tableau **archivé**, case « Afficher les archivés » cochée | la ligne porte la mention « Archivé » et **la seule** commande « Désarchiver » ; elle n'ouvre aucun canevas (§5.6.2, lignes c à e) |

### 5.5 Accessibilité

Le canevas est **entièrement utilisable au clavier**, et ce n'est pas une option : tabulation entre
les blocs dans l'ordre de leur position, flèches pour déplacer le bloc focalisé, `Entrée` pour
ouvrir sa fiche d'édition, `Espace` puis sélection d'un second bloc pour tracer une flèche. Un
canevas utilisable uniquement à la souris n'est pas terminé (`CLAUDE.md` §22).

**Complété le 2026-08-19, en livrant la tranche 2a**, sur les deux points que l'alinéa ci-dessus
laissait sans binôme clavier. Rien d'autre n'est révisé.

| Geste | Souris | Clavier |
|---|---|---|
| **Poser** un bloc | clic sur le canevas, une fois la pose armée ; le point du clic devient le coin haut gauche | la pose armée dépose un **repère** que les flèches déplacent ; `Entrée` pose, `Échap` annule |
| **Déplacer** le bloc focalisé | glissement du bloc | flèches ; `Maj` + flèches pour le pas fin |
| **Redimensionner** le bloc focalisé | glissement de la poignée d'angle | `Alt` + flèches ; `Maj` s'y combine pour le pas fin |

**Le repère de pose existe parce que la position vient du GESTE** (§3). Sans lui, poser au clavier
n'aurait aucune position à transmettre, et le seul recours serait un placement automatique — que le
§3 interdit. Ce n'est donc pas une commodité d'accessibilité ajoutée après coup : c'est la seule
forme clavier que cette règle admet.

**Deux pas et non un.** Le pas ordinaire sert à composer, le pas fin à ajuster. Sans le second, le
clavier n'atteindrait pas les positions que la souris atteint, et la parité des deux entrées serait
tenue en apparence seulement.

**L'écriture part au RELÂCHEMENT de la touche**, jamais à chaque répétition d'une frappe maintenue :
une touche tenue enfoncée émettrait une requête par pixel parcouru. Aucune temporisation n'est
employée pour l'obtenir (`CLAUDE.md` §18).

Chaque bloc porte un `aria-label` complet — titre, remplissage, channel lié —, et une **liste
textuelle équivalente** du diagramme est rendue pour les lecteurs d'écran : « A → B », « B ↔ C ».
Un diagramme qui n'existe que visuellement n'est pas accessible.

### 5.5 bis Les gestes d'ADMINISTRATION d'un tableau au clavier — tranche 2 g

**Complété le 2026-08-25.** Le §5.5 ci-dessus décrit le clavier du **canevas** — poser, déplacer,
redimensionner, éditer, tracer, supprimer. La **liste** du §5.1 est devenue administrable après lui
(tranche 2 c : créer, renommer, réordonner, archiver), et son clavier n'a jamais été écrit ni
éprouvé. Ce chapitre le fait, et rien d'autre n'est révisé.

#### 5.5 bis.1 Trois mesures, relevées avant d'écrire une règle

Relevées le 2026-08-25 sur la pile seedée, avec le jeton réel de l'administratrice, en lisant
`document.activeElement` après chaque geste — jamais en lisant le code.

| # | Ce qui est mesuré | Relevé |
|---|---|---|
| A | Ordre de tabulation de la liste | depuis « Créer un tableau » : lien du tableau, puis ses commandes **actives** dans l'ordre visuel — monter, descendre, renommer, archiver —, puis le tableau suivant. Une commande désactivée à une extrémité est **sautée** par `Tab`, et n'est donc jamais un cul-de-sac |
| B | `Entrée` sur « Monter » | la ligne change de place, la liste est relue, et **le focus reste sur la commande** : le bouton n'est pas démonté, `document.activeElement` le désigne encore |
| C | `Entrée` sur « Archiver », puis sur la confirmation | le focus revient sur « Archiver le tableau X » — **la commande de la ligne que le geste fait disparaître**. La relecture la démonte, `document.activeElement` retombe sur `body`, et le `Tab` suivant repart du **lien d'évitement**, en tête de document |
| D | `Échap` dans les trois surfaces de la liste | **sans effet** : le formulaire de création, celui de renommage et la confirmation d'archivage restent ouverts, là où la fiche d'un bloc et le repère de pose se referment (§5.5) |

La mesure C est un **défaut du produit**, pas un manque de preuve : celui qui archive au clavier
perd sa place dans le document et doit retraverser l'écran entier pour revenir à la liste qu'il
était en train d'administrer. C'est exactement le défaut que `docs/DESIGN_SYSTEM.md` §5.13 nomme —
« activer *Annuler* au clavier laisse le focus sur un bouton qui vient de disparaître » — sous une
seconde forme que sa règle ne couvrait pas : là-bas la commande survit au geste, ici elle ne lui
survit pas.

#### 5.5 bis.2 Le retour du focus vise une ancre qui SURVIT au geste

`docs/DESIGN_SYSTEM.md` §5.13 pose que fermer une surface rend le focus « à la commande qui l'a
ouverte ». Cette règle suppose que la commande existe encore. **Elle est complétée, jamais
remplacée** : lorsque le geste détruit la ligne qui porte sa propre commande, le focus revient à la
**commande de création de l'en-tête**, qui est rendue en toute circonstance — y compris sur une
liste devenue vide, où elle est le seul geste restant (§5.1). Il ne retombe jamais sur le document.

| Geste | Issue | Le focus revient à |
|---|---|---|
| Création | succès, annulation, `Échap` | « Créer un tableau » — la commande qui l'a ouverte, jamais démontée |
| Renommage | succès, annulation, `Échap` | « Renommer le tableau X » — la ligne survit au geste |
| Archivage | annulation, `Échap` | « Archiver le tableau X » — la ligne est encore là |
| Archivage | **succès** | « Créer un tableau » — la ligne, et donc la commande, viennent de disparaître |
| Réordonnancement | succès, refus, déplacement impossible | il ne bouge pas : aucune surface ne s'ouvre, et la commande reste montée (mesure B) |

**Aucune temporisation** n'est employée pour l'obtenir (`CLAUDE.md` §18) : le mécanisme est celui
que la tranche 2 c porte déjà — un drapeau, puis un effet qui cherche l'ancre par son attribut
`data-focus`. Seule l'**ancre visée** change, et elle est choisie au moment où l'issue est connue.

**Pourquoi l'en-tête et non la ligne voisine.** Une ligne voisine serait une meilleure continuité,
mais elle n'est pas connaissable au moment du retour : la liste est relue de façon asynchrone, et
viser une ligne qui n'est pas encore rendue rejouerait le défaut de la mesure C sous une autre
forme. La commande de création est adjacente à la liste, stable, et c'est le geste qu'on enchaîne le
plus souvent après avoir rangé.

#### 5.5 bis.3 `Échap` referme les trois surfaces de la liste

`Échap` ferme le formulaire de création, le formulaire de renommage et la confirmation d'archivage,
depuis **n'importe lequel de leurs contrôles**, et rend le focus selon le tableau du §5.5 bis.2.
Ce n'est pas un geste inventé pour cette surface : c'est la règle que le design system pose déjà
trois fois pour une surface qui **remplace sa commande** — §5.3 quater, §5.3 septies —, et que la
fiche d'édition d'un bloc du même écran tient depuis la tranche 2 b-1 (§5.5). Sans elle, l'écran
oppose deux conventions contraires à la même touche selon qu'on administre la liste ou qu'on édite
un bloc.

**`Échap` ne ferme que la surface la plus intérieure, et il n'y en a jamais deux.** L'état de la
liste n'admet qu'une surface ouverte à la fois — création, renommage d'un tableau, ou confirmation
d'archivage d'un tableau —, si bien qu'aucune précédence n'est à écrire. `Échap` ne quitte pas
l'écran et ne remonte pas au canevas.

**Une écriture en vol n'est pas annulée par `Échap`** — rien ne l'annule côté serveur, et prétendre
le contraire serait faux. La surface se ferme, l'écriture aboutit, et son issue est lue dans la
mention de la **section**, qui n'est tue que tant qu'une surface est ouverte (`docs/DESIGN_SYSTEM.md`
§5.29). Le focus, déjà rendu à son ancre, y reste : l'issue le ramène à la même ancre, jamais à une
autre.

#### 5.5 bis.4 Ce que ce chapitre ne change pas

- **Aucune commande n'est éteinte d'avance selon le rôle** : la lectrice atteint les quatre
  commandes au clavier, envoie, et lit le refus traduit. La règle est inchangée.
- **Les commandes d'ordre restent désactivées aux extrémités et jamais masquées** (§5.13) : la
  mesure A établit que `Tab` les saute, ce qui est le comportement natif d'un bouton désactivé et
  non une décision de l'écran.
- **Aucun piège de focus, aucun voile, aucune modale** : les trois surfaces vivent dans le flux du
  document, et c'est ce qui rend `Échap` suffisant.

#### 5.5 bis.5 Ouvrir une surface efface la mention de la précédente

**Défaut trouvé EN REGARDANT UNE CAPTURE** (`CLAUDE.md` §16), et non en lisant un test : la
confirmation d'archivage ouverte juste après une création réussie affichait « Tableau créé », en
vert, **sous son bouton destructif** — l'issue d'un geste qu'elle n'a pas causé, lue à l'endroit
exact où l'on s'apprête à en commettre un autre.

La cause est structurelle et non cosmétique : la mention est portée par un **état unique** de la
liste, tandis que les trois surfaces la rendent chacune près de son propre champ (§5.13, « le
message se lit près de ce qui l'a causé »). Une mention qui survit à la surface qui l'a produite
change donc de propriétaire au lieu de disparaître.

**Règle : ouvrir l'une des trois surfaces remet la mention à vide.** Rien n'est masqué pour autant
— elle avait déjà été lue dans la mention de **section**, seul endroit où elle vit tant qu'aucune
surface n'est ouverte. Fermer, en revanche, ne l'efface pas : c'est la fermeture qui la fait
**paraître** dans la section, et l'effacer là reviendrait à taire l'issue du geste qu'on vient de
faire.

Ce défaut est **antérieur à cette tranche** — il vit dans la liste depuis la tranche 2 c et se
produit aussi à la souris —, mais il n'est pas étranger à elle : c'est le parcours clavier de cette
tranche qui enchaîne les surfaces assez vite pour le rendre visible, et c'est sa capture qui l'a
montré.

### 5.6 Reprendre un tableau archivé — tranche 2 h

**Pourquoi cette section existe.** L'archivage d'un tableau **tient lieu de suppression** (§2.1), et
jusqu'au 2026-08-28 il était **sans retour** : aucun écran ne rendait un tableau archivé, aucune
commande ne le ramenait. Un tableau archivé par erreur était donc perdu pour l'utilisateur alors que
sa donnée était **intacte en base** et que la politique `goal_boards_maj_membre_ecrivant` autorise
sans réserve de rendre `archived_at` à `null`. C'est une **perte silencieuse**, que `CLAUDE.md` §18
proscrit, et c'est ce que cette section referme.

**Ce qui a tenu la commande hors du produit, et pourquoi ce n'est plus un motif.** Le §5.1 ne
décrivait qu'une liste des tableaux **non** archivés ; poser la commande supposait donc d'abord
« une surface où le retrouver, qu'aucune unité ne spécifie ». **L'arbitrage est rendu**
(`docs/JOURNAL.md`, décision 534) : cette surface n'est pas à inventer, **le produit la porte
déjà**. L'administration des tracks et des channels (`CRM-075`,
`webapp/src/app/AdministrationArborescence.tsx`) résout exactement le même problème sur exactement
le même geste, et sa forme est reprise **sans écart** — c'est la ligne du responsable, « le
comportement le plus simple, et le même partout » : deux écrans qui font la même chose la font de la
même façon.

#### 5.6.1 Les six mesures qui fondent le contrat

Relevées le **2026-08-28** sur la pile de développement seedée, par la **vraie route REST** et avec
les **jetons réels** des trois profils du seed. Aucune n'est déduite.

| # | Mesure | Relevé |
|---|---|---|
| 1 | `PATCH goal_boards` posant `archived_at`, jeton de l'administratrice | `200`, colonne posée |
| 2 | `POST goal_boards` reprenant le nom d'un tableau **archivé** | `409` / `23505`, `goal_boards_workspace_name_key` |
| 3 | `GET goal_boards?archived_at=not.is.null`, jeton de la **lectrice** | `200`, la ligne archivée est **rendue** |
| 4 | `PATCH archived_at=null`, jeton de la **lectrice** | `200` et **`[]`** — refus silencieux de la clause `using`, jamais un `403` |
| 5 | `PATCH archived_at=null`, jeton du **business developer** | `200`, `archived_at` nul, **`position` conservée** |
| 6 | `pg_indexes` sur `goal_boards` | l'unicité de nom est **totale**, l'index d'**ordre** seul est partiel |

**La mesure 3 décide de la lecture** : `goal_boards_lecture_membre` ne regarde que
`app.is_workspace_member(workspace_id)` et **ignore `archived_at`**. Tout membre, lectrice comprise,
peut donc lire un tableau archivé. Le masquage du §5.1 est **un choix du client**, jamais une règle
d'accès — et l'étendre ne demande **aucune migration, aucune politique, aucun privilège**.

**La mesure 4 décide du refus** : la lectrice n'obtient pas un `403` mais l'issue **`sans-effet`**
que `modifierTableau` sait déjà distinguer depuis la tranche 2 c. Elle se traduit par le refus
`interdit` du dictionnaire fermé existant ; **aucun corps d'erreur du serveur n'est affiché**.

**La mesure 6 ferme une question qu'on aurait pu croire ouverte** : le désarchivage ne peut **jamais**
heurter un doublon de nom. L'index d'unicité étant total, l'archivage n'a jamais libéré le nom —
la mesure 2 le montre en refusant `409` — et le rendre ne peut donc rien heurter. Le dictionnaire de
refus n'a **pas** à gagner de cas `doublon` sur ce geste, et une assertion le fige plutôt qu'un
commentaire l'affirme.

#### 5.6.2 Contrat opposable de la liste

| Ligne | Situation | Comportement attendu |
|---|---|---|
| a | Case « Afficher les archivés » **décochée** — l'état par défaut | La liste est exactement celle du §5.1, inchangée |
| b | Case **cochée** | La liste rend **aussi** les tableaux archivés, dans le même ordre (`position`, puis `name`) |
| c | Ligne archivée | Porte la mention **« Archivé »**, comme une ligne de l'arborescence |
| d | Ligne archivée | Ne porte **que** « Désarchiver » : monter, descendre, renommer et archiver en sont **retirés** — réordonner ou renommer un objet masqué n'a pas d'effet observable |
| e | Ligne archivée | N'est **pas** un lien vers son canevas : `lireContenuTableau` filtre `archived_at is null`, et le lien mènerait à un « tableau introuvable » que rien n'expliquerait |
| f | « Désarchiver » | S'exécute **sans confirmation** — le geste ne détruit rien, il rend ; la confirmation est réservée à ce qui coûte (§5.13) |
| g | Administratrice ou business developer | Le tableau revient dans la liste **à sa position d'origine** (mesure 5), et le message vivant le dit |
| h | Lectrice | Refus `interdit` du dictionnaire fermé ; la ligne est **relue** et constatée toujours archivée |
| i | Ligne archivée | Son compte de blocs est celui de ses blocs **lisibles par l'appelant**, comme toute ligne (§5.1) |
| j | Case cochée, **aucun** tableau du tout | L'état vide du §5.4, inchangé |

#### 5.6.3 Ce que cette section ne fait pas

- **Aucune migration, aucune politique, aucun privilège** : tout le contrat backend existe depuis
  `CRM-082` (migration `0049`). La tranche **exerce** ce qui est déjà là.
- **Aucun écran nouveau, aucune route nouvelle** : la case vit dans la liste existante.
- **Aucune purge, aucune corbeille de tableau** : l'archivage et la mise à la corbeille restent deux
  notions distinctes (`docs/SPEC-corbeille.md` §3.1), et un tableau n'entre pas en corbeille.
- **Aucun tri, aucun filtre supplémentaire** : la case est un **élargissement** de la liste, pas un
  filtre qui n'en montrerait que les archivés.

#### 5.6.4 Definition of Done de la tranche 2 h

- les dix lignes du contrat du §5.6.2 exercées ;
- `desarchiverTableau` dans `webapp/src/lib/objectifs-ecriture.ts`, et `lireTableaux` capable
  d'inclure les archivés — **le paramètre par défaut préserve le comportement du §5.1** ;
- **test unitaire dédié** du module et du composant, éprouvant la **requête émise** et non la seule
  valeur rendue ;
- **test d'API dédié** avec les jetons réels des trois profils, chaque refus **relisant la ligne** ;
- **test E2E d'interface dédié**, console vierge, aux quatre paliers ;
- **seed enrichi d'un tableau archivé** (`CLAUDE.md` §8) : sans lui, la case cochée ne montrerait
  rien en démonstration et la fonctionnalité serait livrée sans être démontrable ;
- **captures produites ET observées** (`CLAUDE.md` §16) ;
- `docs/DESIGN_SYSTEM.md`, `docs/manual.md`, `docs/SPEC-seed.md` et `CHANGELOG.md` dans le même
  changement.

### 5.7 L'état de LECTURE SEULE du canevas — tranche 3, arbitrage d'INC-170 rendu

**Ce chapitre ferme INC-170**, ouverte le 2026-08-19 en livrant la tranche 2a, et laissée sans issue
depuis. Il est écrit et committé **avant** la première ligne de code, comme le §5.6 l'a été
(`CLAUDE.md` §5), et fondé sur **quatre mesures** prises le 2026-08-28 sur la pile seedée avec les
jetons réels des trois profils, jamais sur un souvenir.

#### 5.7.1 Ce qui était contradictoire, et ce qui ne l'était pas

Le §5.4 demandait, dans sa rédaction d'origine, que « tous les gestes d'écriture soient
indisponibles et lisibles » pour le **`viewer`**. `docs/DESIGN_SYSTEM.md` pose neuf fois l'inverse —
§5.3, §5.13, §5.16, §5.21, §5.23, §5.25, §5.26, §5.27, §5.28 — et toujours avec le même motif :
**« aucune commande n'est éteinte d'avance SELON LE RÔLE »**, parce que la règle réelle vit dans les
politiques et qu'un rôle ne la résume pas.

**La contradiction ne portait pas sur l'état de lecture seule : elle portait sur son DÉCLENCHEUR.**
Ce que le design system interdit est une **déduction d'écran à partir d'un rôle**. Ce qu'il n'a
jamais interdit — et qu'il décrit lui-même au §5.31, pour la table de saisie des coûts réels — est
un état de lecture seule **dérivé d'une capacité que la BASE consent**, rendue comme une colonne
calculée. `public.reel_saisissable(card_costs)` (migration 52, `docs/SCHEMA.md` §9 bis.8) est
exactement ce mécanisme, et il est en production depuis `CRM-086`.

#### 5.7.2 Les quatre mesures qui fondent le contrat

Prises le 2026-08-28, pile seedée, par la vraie route REST et par `psql` sous l'identité réelle de
chaque profil.

| # | Mesure | Résultat |
|---|---|---|
| **A** | `GET /rest/v1/goal_boards` avec les jetons de l'administratrice, du business developer et de la lectrice | les **trois** rendent `200` et les **deux** tableaux du seed. La lecture ne sépare rien |
| **B** | `app.can_write_goal_board('…e1')` sous `set local role authenticated` et les `sub` réels | `t` pour l'administratrice, `t` pour le business developer, `f` pour la lectrice, `f` pour `anon` |
| **C** | La lectrice écrit sur un bloc du tableau | `PATCH` → `200` et `[]` ; `DELETE` → `200` et `[]` ; `POST` → `403` / `42501`. Les deux formes de refus du §7 de `docs/SPEC-permissions-rls.md`, et non une seule |
| **D** | Le business developer, dont la mesure B dit `t`, pose un lien vers « Maintenance » — channel qu'il **lit** sans l'**écrire** | `403` / `42501`. La capacité vraie au niveau du TABLEAU n'entraîne donc pas que tout geste passe |

#### 5.7.3 L'issue retenue, et pourquoi les deux autres sont écartées

**RETENUE.** Le §5.4 est révisé : l'état de lecture seule reste dû, et son déclencheur devient la
**capacité consentie par la base** — une colonne calculée `public.ecriture_permise(goal_boards)`,
`security invoker`, dont le corps est `app.can_write_goal_board(id)`. L'écran ne lit **aucun rôle**
et n'en déduit rien : il rend ce que la base lui dit d'elle-même.

*Écartée n° 1 — retirer la ligne du §5.4 et laisser le canevas envoyer puis traduire.* C'est ce que
la tranche 2a fait par défaut, et la mesure C dit ce qu'il en coûte : **deux** des trois gestes de
la lectrice rendent `200` et zéro ligne, c'est-à-dire ni un succès ni une erreur. Un canevas entier
dont chaque geste se solde par « rien n'a été enregistré » enseigne la règle **après** l'avoir fait
transgresser, et `CLAUDE.md` §18 proscrit précisément la perte silencieuse.

*Écartée n° 2 — poser au canevas un écart nommé au design system.* Un écart isolerait cet écran
alors que le produit possède déjà le patron : ce serait le « comportement juste une fois sur deux »
que `docs/CloudWorker.md` §4.1 bis nomme comme pire qu'une règle uniformément stricte.

**La règle générale du design system n'est pas amendée**, et c'est le point : elle vise le rôle, et
la capacité n'est pas un rôle. Le §5.29 ter la reformule sans la relâcher.

#### 5.7.4 Contrat opposable

| | Situation | Rendu |
|---|---|---|
| **a** | `ecriture_permise` vaut `true` | canevas inchangé — toutes les commandes offertes, tous les refus traduits comme aujourd'hui |
| **b** | `ecriture_permise` vaut `false` | une **mention de lecture seule** en tête du canevas, du ton neutre du `docs/DESIGN_SYSTEM.md` §8, disant que ce tableau est consultable et non modifiable ; les commandes de pose et de tracé **désactivées et lisibles** ; la fiche d'édition d'un bloc **ouverte** et ses champs **désactivés** ; aucune commande de suppression |
| **c** | `ecriture_permise` absente, nulle ou d'un type inattendu | traité comme `false` — un type ne garantit jamais une valeur, c'est la règle qu'`estSaisissable` applique déjà au §4.8.1 de `docs/SPEC-costs.md` |
| **d** | `ecriture_permise` vaut `true` et un geste est **quand même** refusé (mesure D) | le refus est traduit comme aujourd'hui, avec son texte propre. La capacité est une condition **suffisante** de refus, jamais **nécessaire** : l'écran ne rejoue aucune règle de la base |
| **e** | Lecture du **contenu** | inchangée. La colonne n'ouvre ni ne ferme aucune ligne : elle n'est rendue que sur un tableau que la RLS a déjà consenti |
| **f** | Liste des tableaux (§5.1) | **inchangée**, et c'est délibéré : créer un tableau relève du workspace et non d'un tableau, `app.can_write_goal_board` n'a donc rien à en dire. La liste continue d'envoyer et de traduire |
| **g** | Équivalent textuel du diagramme (§5.5) | inchangé. Il décrit ce qui est **lu**, et la lecture seule ne retranche rien de lisible |

**Aucune migration de données, aucune politique, aucun privilège de table.** La migration n'ajoute
qu'une fonction et ses `grant`, `anon` compris — pour la raison exacte de la migration 52 : sans
lui, un appelant anonyme atteignant `goal_boards` recevrait une erreur de privilège là où
`docs/SPEC-permissions-rls.md` §7 exige zéro ligne.

**`security invoker` est une exigence, pas un défaut accepté.** En `definer`, la fonction répondrait
pour son propriétaire, qui traverse la RLS, et rendrait `true` à **tout** appelant — la lectrice
comprise. Le §5.4 se lirait alors exactement à l'envers.

#### 5.7.5 Definition of Done de la tranche 3

- les sept lignes du contrat du §5.7.4 exercées ;
- migration dédiée, **rejouable**, et `notify pgrst, 'reload schema'` : une colonne calculée neuve
  reste invisible au cache de PostgREST jusqu'à son rechargement (leçon de la migration 52) ;
- **pgTAP dédié** : la fonction existe, est `invoker`, rend `f` à la lectrice et `t` aux deux
  autres, et `anon` la exécute sans erreur de privilège ;
- **test unitaire dédié** du module et du composant, la ligne **c** éprouvée sur `null` et sur
  `undefined` ;
- **test d'API dédié** : la colonne demandée dans le `select` avec les jetons réels des trois
  profils, et la mesure D reconduite — capacité vraie, geste refusé ;
- **test E2E d'interface dédié**, console vierge, avec le jeton réel de la lectrice ;
- **captures produites ET observées** (`CLAUDE.md` §16) ;
- `docs/SCHEMA.md`, `docs/DESIGN_SYSTEM.md`, `docs/PROD_MIGRATIONS.md`, `docs/INCONSISTENCY_REPORT.md`
  et `CHANGELOG.md` dans le même changement.

## 6. Ce qui n'est pas au périmètre

Nommé pour que personne ne le suppose livré :

- aucun modèle de tableau, aucune duplication de tableau ;
- aucun historique des positions, aucun « annuler » au-delà de la session d'édition en cours ;
- aucune collaboration temps réel — deux personnes qui déplacent le même bloc appliquent la règle
  du dernier qui écrit, et l'écran ne le signale pas ;
- aucun export image ;
- aucune pièce jointe sur un bloc ;
- **aucun calcul, aucun lien automatique** (§1).
