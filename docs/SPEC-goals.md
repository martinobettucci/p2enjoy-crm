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
| `name` | non vide, unique par workspace après normalisation des espaces |
| `description` | facultative |
| `position` | ordre d'affichage dans la liste, attribuée par trigger si omise, comme `tracks.position` |
| `archived_at` | l'archivage tient lieu de suppression, comme pour les tracks et les channels |

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
| Lecture seule (`viewer`) | tous les gestes d'écriture sont **indisponibles et lisibles**, et l'écran dit pourquoi — `docs/DESIGN_SYSTEM.md` §8 |

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

## 6. Ce qui n'est pas au périmètre

Nommé pour que personne ne le suppose livré :

- aucun modèle de tableau, aucune duplication de tableau ;
- aucun historique des positions, aucun « annuler » au-delà de la session d'édition en cours ;
- aucune collaboration temps réel — deux personnes qui déplacent le même bloc appliquent la règle
  du dernier qui écrit, et l'écran ne le signale pas ;
- aucun export image ;
- aucune pièce jointe sur un bloc ;
- **aucun calcul, aucun lien automatique** (§1).
