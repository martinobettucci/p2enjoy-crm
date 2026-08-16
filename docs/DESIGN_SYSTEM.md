# Design System — P2Enjoy CRM

Référence maîtresse de l'interface. Dérivée de la **charte P2Enjoy SAS**.

**Ce fichier se lit intégralement avant toute modification, revue ou commit touchant l'UI ou
l'UX**, y compris pour une correction visuelle jugée mineure. Le diff UI est vérifié contre ce
document avant commit ; si une règle, un composant ou un écart est introduit, le document est
mis à jour dans le même changement.

Unité de backlog : `CRM-000`. Documents liés : `docs/SPEC-form-composer.md` (rendu des champs),
`docs/manual.md` (captures).

---

## 1. Palette

| Rôle | Token | Hex | Usage dans le CRM |
|---|---|---|---|
| **Bleu P2Enjoy** (primaire) | `--color-brand` | `#23468C` | Actions primaires, liens, track actif, anneau de focus |
| **Vert** (succès) | `--color-success` | `#238C33` | Étapes `won`, confirmations, compte mail connecté |
| **Jaune** (accent) | `--color-accent` | `#D9CF4A` | Un seul surlignage par vue : la tuile de pipeline pondéré |
| **Rouge** (danger) | `--color-danger` | `#F24141` | Étapes `lost`, erreurs, cards figées, échec d'envoi |
| **Noir** (encre) | `--color-ink` | `#0D0D0D` | Titres et texte fort |

Déclinaisons calculées, jamais d'hexadécimal ad hoc dans un composant :
`--color-brand-soft` (10 %) pour les fonds de pilule et de badge, `--color-brand-hover` `#1B3670`,
et les équivalents pour succès, danger et accent en fonds à 10–22 %.

`--color-*-on-soft` — le jeton **écrit sur son propre fond doux**, assombri juste assez pour tenir
le contraste AA du §8 tout en conservant sa teinte. Voir l'écart §12.5 : « texte à la couleur
pleine » échoue à 4,5:1 pour `success`, `accent` et `danger`. Valeurs calculées à partir du jeton
plein, au même titre que les fonds doux.

`--color-veil` — l'encre à 40 % — est le voile posé sous toute surface qui recouvre l'écran :
tiroir de navigation, et modales à venir. C'est un **jeton**, et non un modificateur d'opacité
écrit dans le composant : mesuré, un `bg-ink/40` fait recopier la valeur hexadécimale dans le CSS
produit, en repli des navigateurs sans `color-mix` (`CRM-007`).

### Neutres

| Usage | Token | Hex |
|---|---|---|
| Fond de page | `--color-bg` | `#F7F8FA` |
| Surface (cartes, barre latérale, modales) | `--color-surface` | `#FFFFFF` |
| Bordures et séparateurs | `--color-border` | `#E5E7EB` |
| Texte secondaire | `--color-text-2` | `#4B5563` |
| Texte tertiaire, placeholders | `--color-text-3` | `#6B7280` |
| Survol neutre | `--color-hover` | `#F3F4F6` |

**Thème clair uniquement**, aligné sur le site corporate. Pas de thème sombre tant que la charte
n'en définit pas un.

### Couleurs de données

Les tracks et les nœuds de workflow portent une couleur, choisie **parmi les jetons ci-dessus**
et stockée sous forme de nom de jeton (`brand`, `success`, `accent`, `danger`, `neutral`), jamais
d'hexadécimal libre. Une couleur ne porte jamais seule une information : elle accompagne toujours
un libellé ou une icône.

## 2. Typographie

- **Police** : pile système `ui-sans-serif, system-ui, sans-serif`.
- **Titres** : 700, encre. H1 26 px, H2 20 px, H3 16 px.
- **Corps** : 15 px, `#374151`, interligne 1,55.
- **Données techniques** (adresse email de card, identifiants, horodatages, montants) :
  `ui-monospace` 13 px, chiffres tabulaires.
- **Jamais de texte sous 12 px.**

## 3. Espacements et rayons

- Échelle d'espacement : 4, 8, 12, 16, 24, 32, 48 px. Aucune valeur intermédiaire.
- Rayons : `--radius-sm` 8 px (champs, boutons), `--radius-md` 10 px (pastilles d'icône),
  `--radius-lg` 14 px (cartes, modales), `rounded-full` (badges, pilules, avatars).
- Ombre de carte : `0 1px 3px rgb(0 0 0 / .06)`, légèrement renforcée au survol.

## 4. Architecture des écrans

```
┌──────────────┬───────────────────────────────────────────────────────┐
│ Barre        │  En-tête : fil d'Ariane · recherche · Cmd+K · profil   │
│ latérale     ├───────────────────────────────────────────────────────┤
│              │  Onglets des channels du track courant                 │
│ Tracks       ├───────────────────────────────────────────────────────┤
│ (pilules)    │                                                       │
│              │  Board kanban (colonnes = étapes du workflow)         │
│ Inbox        │  ou vue liste                                         │
│ Ma journée   │                                                       │
│ Réglages     │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
```

- **Barre latérale** : tracks en pilules, plus les entrées transverses (Inbox, Ma journée,
  Réglages). Repliable ; l'état de repli est une préférence de session, pas une donnée
  persistée sans consentement.
- **Onglets** : les channels du track courant, en **liens** de navigation et non en `tablist`
  (§12.1). Débordement horizontal défilable, jamais tronqué sans indication — l'indication est
  portée par `.indique-debordement-x` (§12.6).
- **Board** : une colonne par étape, dans l'ordre `workflow_steps.position`. En-tête de colonne
  avec libellé, compteur, et montant cumulé lorsque le montant est utilisé.

## 5. Composants

### 5.1 Carte de card (board)

Carte blanche `--radius-lg`, bordure 1 px, **liseré supérieur de 3 px** à la couleur du nœud.
Contenu : titre (2 lignes maximum, ellipse), pastilles d'étiquettes, avatar du responsable,
montant si renseigné, indicateur de prochaine action, et pastille d'ancienneté dans l'étape
(neutre, puis `--color-danger` au-delà du seuil de relance).

Le glisser-déposer utilise une zone de saisie visible au clavier : chaque card expose aussi un
menu d'actions listant **uniquement les transitions déclarées**. C'est la garantie que
l'interface ne propose jamais une action que le backend refuserait.

**Identité — contrat `CRM-022`.** L'avatar du responsable est enfin rendu lorsque `owner_id` est
renseigné. Il mesure 32 px, porte le nom complet comme nom accessible et se replie sur les
initiales ; aucun UUID n'atteint l'écran. La donnée vient de la relation `profiles` embarquée avec
la card, jamais d'une requête par carte.

### 5.2 Colonne de board

En-tête collant, fond `--color-bg`, compteur en badge neutre. Zone de dépôt signalée par un
liseré `--color-brand` en pointillés pendant le glissement. État vide : message et action
(« Aucune card à cette étape — créez la première »).

### 5.2 bis Ce que le board a appris en étant rendu — `CRM-041`

Trois règles ajoutées par le premier board réellement exécuté. Les deux premières ont été trouvées
**en regardant une capture**, la troisième **en mesurant** un comportement du navigateur.

- **Le liseré d'une carte dont le nœud est `neutral` emploie `--color-text-3`, non
  `--color-border`.** Écrit d'abord avec la couleur de bordure, il était **invisible** sur la
  surface blanche d'une carte : la colonne `Prospection` paraissait n'avoir aucun liseré à côté de
  `Relance`, qui portait le sien. `--color-text-3` est déjà le jeton du **point neutre** d'un badge
  (§5.6) : un neutre discret, mais lisible. La règle du §1 — « une couleur ne porte jamais seule une
  information » — reste tenue par le libellé de la colonne.

- **Une colonne de board a une largeur fixe de 288 px.** Ce n'est pas une valeur de l'échelle du §3,
  et ce n'en est pas une : c'est la **forme du contenu attendu**, au même titre que
  `--size-placeholder`. Une colonne élastique se réduirait à rien dès que le workflow compte sept
  étapes, et le §7 exige que le board défile **dans son conteneur** plutôt que d'écraser ses
  colonnes.

- **L'indication de zone de dépôt ne s'éteint pas sur `dragleave`.** MESURÉ dans Chromium :
  `dragleave` remonte des enfants et son `relatedTarget` est **nul** pendant un glisser-déposer — il
  n'existe donc aucun moyen de distinguer « le pointeur quitte la colonne » de « le pointeur entre
  dans une carte de la colonne ». Une indication qui s'y fierait clignoterait, contre le §6. L'état
  de survol est **unique pour tout le board** : passer d'une colonne à l'autre l'écrase, et la fin
  du glissement l'éteint.

Le board lui-même — colonnes, ordre, cumuls, transitions atteignables, refus — est spécifié dans
`docs/SPEC-workflow-engine.md` §7, et non ici : ce document donne les règles visuelles, pas
l'algorithme qui décide **ce que** l'écran montre.

### 5.3 Détail de card

Deux colonnes sur grand écran, empilées sous 1024 px :
- à gauche, le **formulaire conditionnel** (voir `docs/SPEC-form-composer.md`) et les champs
  d'entête (titre, responsable, montant, prochaine action) ;
- à droite, la **timeline unifiée** : commentaires, transitions, activités, emails, pièces
  jointes, dans un fil chronologique unique avec filtres par type.

L'adresse email de la card est affichée en monospace, avec une action de copie et une infobulle
expliquant son usage.

**Le geste de mise à la corbeille d'une affaire vit ici — `CRM-077`, `docs/SPEC-corbeille.md`
§4 ter.** C'est la première commande d'écriture que cet écran porte, et les règles ci-dessous sont
celles qu'elle introduit. Tout ce que le §5.13 pose pour l'arborescence vaut sans être répété :
confirmation dans le flux du document, jamais en modale ; focus entrant dans la confirmation ;
alerte de refus dans le bloc concerné.

- **La commande est en bas de la colonne GAUCHE, sous le formulaire**, dans un bloc séparé par une
  bordure haute `--color-border`. La colonne droite porte le fil (§5.10, §5.11) : elle **raconte** ce
  qui est arrivé à l'affaire, et un geste qui agit n'appartient pas au récit. Le bloc est en bas
  parce qu'un retrait n'est pas ce qu'on vient faire sur une fiche.
- **La commande qui OUVRE la confirmation est secondaire, pas destructive**, et porte l'icône
  `Trash2` — la même que la sixième commande du §5.13, et pour la même raison : `Archive` dirait un
  autre état. C'est le **bouton de la confirmation** qui est destructif plein (§5.5), exactement
  comme au §5.13 : la teinte de danger annonce le geste qu'on est sur le point de commettre, pas
  celui qu'on envisage. Le libellé nomme le geste, pas l'objet ; c'est la confirmation qui nomme
  l'affaire (§6).
- **Sa confirmation ne porte AUCUNE énumération**, contrairement à celle du §5.13 : une affaire n'a
  pas d'enfant, et les quatre états du compte n'y ont donc aucun objet. Elle n'écrit pas non plus
  « aucun objet ne devient inaccessible » — cette phrase répond à une mesure, et ici aucune mesure
  n'a lieu.
- **Le succès remplace le contenu de l'écran, il ne le laisse pas mentir.** L'affaire quitte la
  lecture de sa propre route — mesuré : elle est lue `deleted_at=is.null` —, et « Affaire
  introuvable » serait faux pour celui qui vient de la retirer. Le bloc de succès porte
  `role="status"` (§8), nomme l'état, et offre **deux** chemins : le channel, et la corbeille où
  l'affaire se restaure. Aucune annulation sur place : restaurer est le geste du §5.16, avec ses
  refus.
- **La commande n'est jamais éteinte d'avance**, quel que soit le rôle — même règle que « Restaurer »
  au §5.16. Mesuré : un business developer réussit ce geste là où il échoue sur un track, la
  politique portant sur le droit d'écriture du channel et non sur un rôle.

### 5.4 Inbox

Trois panneaux : dossiers (arborescence Track → Channel → Card, plus « Non classés »), liste des
messages, message affiché. Sous 1024 px, navigation par pile : dossiers → liste → message.

Un message classé affiche la card à laquelle il appartient sous forme de pilule cliquable. Un
message non classé affiche l'action « Classer dans une card » et, le cas échéant, la suggestion
proposée par le classement assisté, toujours présentée **comme une suggestion à confirmer**.

**Livré par `CRM-057`, et voici les règles que l'écran tient** (le contenu et les droits sont dans
`docs/SPEC-mail-subsystem.md` §18) :

- **La pile sous 1024 px est une pile, pas trois panneaux rétrécis.** Un seul panneau est visible à
  la fois, un bouton « Retour » remonte d'un cran, et le titre de l'écran dit où l'on se trouve.
  Trois colonnes de 120 px ne montreraient ni un objet, ni un expéditeur, ni un corps.
- **Le dossier retenu et le message retenu portent `aria-current`**, non une simple couleur : une
  sélection qui ne s'annonce qu'en teinte n'existe pas pour un lecteur d'écran, et le §10 l'exige.
- **L'arborescence est une liste de boutons, dépliable au clavier**, dans l'ordre du board. Chaque
  nœud porte son nombre de messages **visibles par celui qui regarde**.
- **Le corps du message est du texte**, jamais le HTML de l'expéditeur (§18.4). Il conserve ses
  retours à la ligne et se replie sur les mots longs plutôt que de déborder.
- **Une pièce jointe non saine n'a pas de lien** : elle affiche son statut d'analyse en toutes
  lettres — « en cours d'analyse », « écartée par l'antivirus », « non analysée » — et le bouton de
  téléchargement est **absent**, non désactivé. Un bouton grisé promet ce que le serveur refusera.
- **Les quatre états du §5.8 sont traités** : chargement, erreur avec reprise, absence de message,
  et absence de sélection — ce dernier étant l'état normal à l'arrivée sur l'écran, pas un vide.

### 5.5 Boutons

| Variante | Style |
|---|---|
| Primaire | Fond `--color-brand`, texte blanc, `--radius-sm`, survol `--color-brand-hover` |
| Secondaire | Fond blanc, bordure `--color-border`, survol `--color-hover` |
| Destructif | Rouge, plein ou contour, toujours séparé des actions primaires |
| Discret | Texte seul, réservé aux actions tertiaires |

Hauteur minimale 40 px. Anneau de focus 2 px `--color-brand` avec décalage.

**Deux tailles, et une seule cible.** La taille *normale* porte son libellé en `--text-base` avec
un rembourrage horizontal de 16 px ; la taille *compacte* le porte en `--text-sm` (13 px) avec 8 px
de rembourrage. **La hauteur minimale de 40 px ne change pas** : une action tertiaire est un texte
plus discret, jamais une cible plus petite — le §8 ne connaît pas d'exception. La taille compacte
est réservée aux actions tertiaires accompagnant une métadonnée de 13 px, comme les deux gestes de
l'auteur au §5.10 ; l'employer pour une action principale contredirait la hiérarchie du §2.

### 5.5 bis Pilule de track — `CRM-020`

Composant de la barre latérale (§4). `rounded-full`, hauteur minimale `--size-target`, fond de la
couleur douce du track, texte à sa couleur pleine, **précédé de son icône Lucide**.

| Jeton `tracks.color` | Fond | Texte |
|---|---|---|
| `brand` | `--color-brand-soft` | `--color-brand` |
| `success` | `--color-success-soft` | `--color-success` |
| `accent` | `--color-accent-soft` | `--color-ink` |
| `danger` | `--color-danger-soft` | `--color-danger` |
| `neutral` | `--color-hover` | `--color-text-2` |

`accent` porte son texte en **encre** et non en jaune : le jaune sur jaune doux n'atteint pas le
contraste AA du §8. `neutral` emploie les neutres existants plutôt qu'un « neutre doux » que la
palette ne déclare pas.

La correspondance vit à un seul endroit, `webapp/src/app/presentation-tracks.ts`, avec un repli
documenté vers `neutral` : la valeur vient du backend, et un type ne garantit jamais une valeur
(`docs/SPEC-types.md`). Idem pour l'icône, dont le catalogue se replie sur `Folder`.

**Les pilules de track ne sont pas cliquables à ce stade** : un track s'ouvre sur ses channels,
livrés par `CRM-021`. Voir §12.4.

### 5.6 Badges et pilules

`rounded-full`, fond de la couleur à 10–15 %, texte à la **déclinaison lisible** de la couleur
(`--color-*-on-soft`), **précédés d'un point ou d'une icône** afin que l'information ne repose
jamais sur la seule couleur.

**« À la déclinaison lisible » et non « à la couleur pleine » : voir l'écart §12.5.** La
formulation d'origine est incompatible avec le §8 pour trois des cinq jetons de donnée. Savoir si
cette correction vaut pour **tous** les badges du produit reste ouvert
(`docs/INCONSISTENCY_REPORT.md`, INC-028).

### 5.7 Champs de formulaire

Libellé au-dessus, 13 px, `--color-text-2`. Champ 40 px de haut, bordure `--color-border`,
focus `--color-brand`. Texte d'aide sous le champ en 13 px `--color-text-3`. Erreur en
`--color-danger` avec icône, `role="alert"`, associée au champ par `aria-describedby`.

Un champ **obligatoire pour la transition en cours** est signalé par un astérisque et la mention
« requis pour passer à <étape> » — l'utilisateur doit comprendre *pourquoi* il est requis.

### 5.7 bis Case à cocher et valeurs en lecture seule — `CRM-037`

Deux règles ajoutées par le premier formulaire réellement rendu, l'une et l'autre trouvées **en
regardant une capture** et non en lisant un test :

- **Une case à cocher occupe une ligne de hauteur `--size-target`.** La case elle-même reste à
  **24 px** — l'agrandir jusqu'à 40 px la ferait passer pour un champ de saisie —, et son libellé
  lui sert de **cible étendue** par son `for`. Sans cette ligne, une case de 16 px isolée était la
  seule cible interactive du produit sous les 40 px du §8.
  **24 px et non 20 :** l'échelle du §3 est fermée, et `--spacing-5` n'existe pas. Écrit d'abord
  en `size-5`, le rendu perdait **silencieusement** sa taille — la classe n'était pas engendrée du
  tout, exactement le défaut que le §11 décrit. Trouvé par le contrôle de classes, pas à l'œil.
- **Une valeur affichée en lecture seule dont le type est un montant, une date ou un horodatage se
  rend en donnée technique** au sens du §2 : monospace, chiffres tabulaires. La règle vit déjà dans
  `webapp/src/styles/app.css`, portée par `code` ; le rendu l'emploie plutôt que de la dupliquer
  dans une classe. `url` en est exclue : une adresse se lit, elle ne se compare pas colonne par
  colonne.

Le rendu conditionnel lui-même — composition, section repliée, mention d'exigence, accessibilité
des erreurs — est spécifié dans `docs/SPEC-form-composer.md` §4, et non ici : ce document donne les
règles visuelles, pas l'algorithme qui décide **quels** champs sont rendus.

### 5.8 États systématiques

Toute vue traite explicitement : chargement (squelettes, pas de spinner plein écran), vide
(message et action), erreur (message compréhensible et action de reprise), et absence de droit
(explication, pas une page blanche).

### 5.9 Tableau de données — `CRM-042`

Premier tableau du produit, livré par la vue liste d'un channel. Le §4 l'annonçait — « board kanban
[…] **ou vue liste** » — sans lui donner une seule règle visuelle. Elles sont écrites ici ; ce que
le tableau **montre** — colonnes, tris, filtres, pagination — est spécifié dans
`docs/SPEC-cards.md` §12, et non ici.

- **Sémantique, jamais simulée.** `table`, `thead`, `tbody`, `th scope="col"`. Une grille de `div`
  prive un lecteur d'écran de la navigation par cellule et de l'en-tête rappelé à chaque cellule.
  Un `role="table"` posé sur des `div` reconstitue au mieux ce que l'élément donne gratuitement.
- **Une ligne = `--size-target`** de hauteur — 40 px, la cible minimale du §8 — et **une seule
  ligne de texte par cellule**, en ellipse, la valeur entière portée par l'attribut `title`. C'est
  la « densité maîtrisée » : un tableau se balaye en diagonale, ce qu'un texte replié interdit.
  L'écart avec la carte de board (§5.1), qui accorde deux lignes au titre, est **voulu** : une
  carte se lit, une ligne se balaye.
- **En-tête collant**, fond `--color-bg`, texte `--color-text-2`, 13 px, comme les libellés de
  champ du §5.7. Séparateur bas 1 px `--color-border`.
- **Séparateurs de lignes, pas de zébrures.** Une bordure basse `--color-border` par ligne. Le
  fond alterné ajoute une couleur qui ne porte aucune information, contre le §1.
- **Survol de ligne** : `--color-hover`. C'est le seul retour visuel, la ligne entière n'étant pas
  cliquable — seul le titre est un lien, pour que la cible du clic soit la cible annoncée.
- **Tri** : un `button` occupe l'en-tête de la colonne triable, et le `th` porte
  `aria-sort="ascending" | "descending" | "none"`. L'icône de sens (`ArrowUp`, `ArrowDown`,
  `ArrowUpDown` de Lucide) accompagne le libellé sans le remplacer : la direction ne repose jamais
  sur la seule icône, `aria-sort` la porte aussi.
- **Alignement** : texte à gauche, **données techniques à droite** — montants et dates, en
  monospace à chiffres tabulaires (§2). Un montant aligné à gauche ne se compare pas colonne par
  colonne, ce qui est la seule raison d'avoir des chiffres tabulaires.
- **Cellule sans valeur : vide.** Ni tiret, ni « — », ni « non renseigné ». Un tiret est un
  caractère que rien ne distingue d'une donnée ; le vide est le seul rendu qui ne prétende rien.
- **Débordement horizontal** : conteneur `overflow-x: auto` portant `.indique-debordement-x`
  (§12.6). Aucun `scroll-snap`, contrairement au board : il n'y a pas de colonne sur laquelle
  s'ancrer.
- **Pagination** : deux boutons secondaires encadrant le rang courant écrit en toutes lettres
  (« Page 2 sur 5 »). Ils sont **désactivés** aux extrémités, jamais masqués — un état désactivé
  reste lisible et explique pourquoi l'action est indisponible (§8).

### 5.10 Panneau de commentaires — `CRM-043`

Premier fil de discussion du produit. Il occupe la **colonne de droite** du détail de card (§5.3),
que `CRM-037` avait laissée vide en nommant l'écart. `CRM-044` y fondra les autres flux — le
panneau est donc écrit comme la première voie d'un fil unifié, non comme un composant isolé.

- **Ordre chronologique CROISSANT** : le plus ancien en haut, le composeur en bas. C'est l'inverse
  du board (§5.1) et de toute liste de nouveautés, et c'est délibéré — on lit une conversation dans
  le sens où elle s'est tenue. La règle est écrite ici pour que `CRM-044` ne l'inverse pas par
  habitude.
- **Un commentaire = une carte discrète** : fond `--color-surface`, coins `--radius-sm`, sans
  bordure ni ombre. La carte du §5.1 est cliquable et porte une élévation ; celle-ci ne mène nulle
  part et n'en porte pas. Le corps est rendu en **texte brut**, `white-space: pre-wrap`, jamais
  interprété comme du markdown (`docs/SPEC-cards.md` §13.13).
- **En-tête d'un commentaire** : avatar 24 px, nom de l'auteur puis date absolue en 13 px
  `--color-text-2`. Si le profil a été supprimé, le nom devient « Compte supprimé » et le corps
  reste intact. Cette règle est livrée par `CRM-022`, qui ferme INC-014 sans inventer un UUID.
- **Mention « modifié »** : suffixe 13 px `--color-text-2` après la date, la date de modification
  portée par l'attribut `title`. Jamais une icône seule.
- **Commentaire supprimé** : la place est **tenue**, le corps remplacé par « Commentaire supprimé »
  en italique `--color-text-2`. Il n'y a rien d'autre à afficher — la base ne porte plus de corps
  (`docs/SPEC-cards.md` §13.4). Le masquer ferait disparaître un tour de parole d'une conversation.

  **Retiré par un tiers, la mention le dit** : « Commentaire retiré par la modération », même
  forme, même teinte. La distinction vient de la donnée — `deleted_by` non nul et différent
  d'`author_id` —, jamais d'un calcul d'écran. **Le nom du modérateur n'est pas affiché** : dire
  *qu'un tiers* a retiré un propos et dire *qui* l'a retiré ne sont pas la même divulgation
  (`docs/SPEC-cards.md` §13.13, point 7).
- **Composeur** : `textarea` de trois lignes qui grandit avec le contenu, libellé visuellement
  masqué (§12.3), bouton primaire « Publier » désactivé tant que le champ est vide ou blanc. Il est
  **toujours rendu** : l'interface ne calcule aucun droit d'écriture, elle envoie et traduit le
  refus du backend (§12.5 bis ci-dessous).
- **Le refus est un message, pas une absence.** Un `403` rend une alerte `--color-danger` sous le
  composeur, dont le texte nomme la cause — « vous ne pouvez pas commenter cette affaire » — et le
  contenu saisi est **conservé**. Vider le champ après un refus ferait perdre le texte à
  l'utilisateur pour une erreur qui n'est pas la sienne.
- **Actions de l'auteur** : « Modifier » et « Supprimer », boutons tertiaires 13 px, visibles au
  survol **et au focus clavier** (§8) — jamais au survol seul. La suppression demande une
  confirmation explicite (§6), son caractère irréversible étant nommé dans le libellé.

  **Elles occupent toujours leur propre ligne**, alignées à droite, sous le nom et la date. Trois
  autres dispositions ont été essayées et **écartées sur capture**, non par principe : partageant la
  ligne de la métadonnée, elles la rétrécissaient jusqu'à couper « 10/08/2026 18:14 » en deux, et en
  **permanence**, puisque des actions transparentes occupent quand même leur place ; en flux sans
  repli, la même ligne se brisait sur trois ; en superposition absolue, elles **recouvraient** la
  date et le début du corps. Une ligne réservée ne cache rien et ne décale rien.

  **Ouvrir la correction déplace le focus dans le champ**, curseur en **fin** de texte. Sans cela,
  activer « Modifier » au clavier laisse le focus sur un bouton qui vient de disparaître, et le
  premier caractère saisi s'insère avant le texte existant. Les deux défauts ont été trouvés par la
  preuve clavier, pas à la lecture.

  **La confirmation n'est pas une modale** : le §5 n'en déclare aucune, et en inventer une pour
  l'occasion ferait porter au design system un composant que personne n'a spécifié. Elle prend la
  place du corps du commentaire, dans le flux du document — ce qui la rend atteignable au clavier
  sans piège de focus.

  **Une pierre tombale n'offre aucune action** : le trigger refuse toute écriture ultérieure
  (`docs/SPEC-cards.md` §13.4), et un bouton qui ne peut pas aboutir est une commande morte.

  **Ce que ces actions ne sont pas** : un contrôle d'accès. L'écran compare `author_id` à
  l'identifiant de session pour ne pas proposer un geste voué au refus ; la règle est tenue par la
  politique `UPDATE`, qui exige l'auteur **et** le droit d'écriture courant. Lorsque la comparaison
  se trompe — droit fin retombé depuis le chargement —, le backend rend `200` et **zéro ligne**, et
  l'écran le dit au lieu d'afficher une modification qui n'a pas eu lieu.
- **Action de modération** : sur le commentaire d'**un tiers**, un `admin` du workspace reçoit
  **une seule** action tertiaire — *Supprimer*. Jamais *Modifier*. La forme porte ici la règle du
  backend au lieu de la contredire : le trigger ne laisse au tiers que la pose de la pierre tombale
  (`docs/SPEC-cards.md` §13.6), et un écran qui offrirait les deux enseignerait une règle fausse.

  **Elle n'est offerte qu'à qui peut aboutir.** L'écran lit le rôle courant dans
  `workspace_members` ; ce n'est pas une autorisation — la politique `card_comments_moderation` la
  tient —, c'est le refus d'une **commande morte**. MESURÉ : un non-administrateur qui tente le
  geste reçoit `200` et zéro ligne, soit un bouton qui ne dit rien et ne fait rien, exactement ce
  que la règle de la pierre tombale ci-dessus proscrit.

  **La confirmation est un texte DISTINCT de celui de l'auteur.** Retirer le propos d'un collègue
  et supprimer le sien n'engagent pas la même chose : la confirmation de modération nomme que le
  commentaire appartient à quelqu'un d'autre, et que **le retrait sera enregistré sous votre nom**.
  Un texte unique obligerait à choisir entre taire la trace au modérateur et alourdir le geste
  ordinaire de l'auteur.
- **Quatre états** (§5.8), et le vide dit « aucun commentaire pour le moment » — sans quoi un
  panneau vide serait indistinguable d'un panneau en panne.
- **Sous 1024 px**, le panneau passe **sous** le formulaire, dans l'ordre du document : une
  conversation se lit après le dossier qu'elle commente.

### 5.11 Timeline unifiée — `CRM-044`

Le §5.10 annonçait le panneau de commentaires comme « la première voie d'un fil unifié ».
`CRM-044` fond les deux : la colonne de droite du détail de card (§5.3) porte **un seul fil**,
alimenté par deux sources — les commentaires et les événements de `card_events` — et filtrable par
famille. Les règles du §5.10 restent en vigueur pour les commentaires ; celles ci-dessous
s'ajoutent, elles ne les remplacent pas.

- **L'ordre du §5.10 est reconduit sans exception : chronologique CROISSANT**, le plus ancien en
  haut, le composeur en bas. Un fil d'activité se lit habituellement du plus récent au plus ancien ;
  ce fil-là contient une conversation, et une conversation se lit dans le sens où elle s'est tenue.
  Inverser l'un briserait l'autre.

- **Un événement n'est pas une carte.** Là où un commentaire est une carte discrète
  (`--color-surface`, `--radius-sm`), un événement est une **ligne** : une pastille d'icône de
  28 px à gauche — carré `--radius-md`, fond doux, icône Lucide 16 px à la couleur pleine, comme
  le §9 la définit —, un texte de 14 px, une date de 13 px `--color-text-2`. La différence de forme
  porte la différence de nature — l'un est une parole, l'autre un fait. Sans elle, le fil serait
  une suite de blocs équivalents où l'œil ne distinguerait plus ce qui a été dit de ce qui est
  arrivé.

- **Aucun filet vertical ne relie les événements**, et c'est une décision prise **après avoir
  regardé** (`docs/JOURNAL.md` décision 212). La règle avait d'abord été écrite ici : un filet de
  1 px derrière les pastilles, interrompu derrière les commentaires. La capture
  `docs/captures/CRM-044/fil-unifie-1440.jpg` montre que la distinction carte / ligne porte déjà
  seule la lecture du fil, et qu'un filet s'interrompant à chaque prise de parole produirait une
  ligne pointillée dont les trous ne signifieraient rien de plus que ce que la forme dit déjà.

- **Une couleur par famille**, et **aucune autre** — les jetons du §1, jamais une teinte inventée :

  | Famille | Types | Pastille | Icône Lucide |
  |---|---|---|---|
  | Discussion | commentaires | **aucune pastille** — un commentaire est une carte (§5.10), pas une ligne d'événement | — |
  | Étapes | `moved` | `--color-brand-soft`, icône `--color-brand` | `ArrowRightLeft` |
  | Champs | `field_changed` | `--color-hover`, icône `--color-text-2` | `PencilLine` |
  | Organisation | `channel_changed`, `workflow_changed` | `--color-accent-soft` pour `channel_changed`, `--color-brand-soft` pour `workflow_changed` | `FolderSync`, `Workflow` |
  | Cycle de vie | `created`, `assigned`, `archived`, `unarchived`, `trashed`, `restored` | `--color-success-soft` pour `created` et `restored`, `--color-accent-soft` pour `assigned` et `unarchived`, `--color-hover` pour `archived` et `trashed` | `Sparkles`, `UserRoundCog`, `Archive`, `ArchiveRestore`, `Trash2`, `RotateCcw` |

  La famille **Discussion** est la seule à ne porter ni pastille ni icône : ses lignes ne sont pas
  des événements, ce sont les cartes du §5.10, et leur donner en plus une pastille reviendrait à
  décorer deux fois la même distinction.

  La couleur ne porte **aucune information seule** (§8) : le libellé dit toujours ce qui s'est
  passé, et l'icône est redondante avec lui.

- **La barre de filtres n'existe que s'il y a quelque chose à filtrer** — décision prise après
  avoir regardé `docs/captures/CRM-044/fil-vide-1440.jpg`, où cinq bascules affichant « 0 »
  surmontaient « aucun événement pour le moment » : un contrôle sans objet. Le seuil porte sur le
  fil **chargé**, jamais sur le fil filtré — sinon éteindre toutes les familles ferait disparaître
  le moyen de les rallumer.

- **Filtres : une barre de cinq bascules**, en haut du panneau, hauteur `--size-target`,
  `rounded-full`, état actif en `--color-brand-soft` / `--color-brand` **et en graisse moyenne** —
  la couleur douce seule ne distinguait pas assez une bascule éteinte d'une bascule active, vu sur
  `docs/captures/CRM-044/fil-filtre-1440.jpg`. L'état éteint porte une bordure `--color-border` sur
  fond `--color-surface`, et `aria-pressed` le dit toujours (§8). Ce sont des boutons
  `aria-pressed`, non des cases à cocher : ils n'appartiennent à aucun formulaire et ne se
  soumettent pas. Toutes actives à l'ouverture.

- **Le compte est écrit sur chaque bascule** — « Étapes 2 » — dans **son propre élément**, jamais
  comme un nœud de texte accolé au libellé : MESURÉ (décision 212), un nœud de texte nu devient un
  élément flex anonyme que `gap` ne sépare pas, et la capture montrait « Discussion1 ». Il compte
  ce que la source contient, **pas** ce que le filtre laisse voir. Un compte qui suivrait le filtre vaudrait toujours
  zéro sur une famille éteinte, et ne dirait plus rien.

- **Acteur nommé lorsqu'il est connaissable.** `CRM-022` ferme INC-014 : le fil affiche « par
  Untel » lorsque `actor_id` résout un profil partagé. Une valeur nulle reste muette, puisqu'elle
  peut désigner une action de service comme un compte supprimé ; le fil n'invente jamais la cause.

- **Un libellé non résolu n'est pas une phrase tronquée.** Lorsque le nom d'une étape ou d'un champ
  n'est pas disponible, la ligne montre le libellé générique de son type — « Étape franchie », sans
  le détail. Aucune phrase n'est construite par concaténation (§10), et aucun `undefined` n'atteint
  l'écran.

- **États** (§5.8) : chargement, erreur avec reprise, et **deux vides distincts** — « aucun
  événement pour le moment » lorsque les deux sources sont vides, et « aucun élément pour ces
  filtres » lorsqu'elles ne le sont pas. Confondre les deux ferait passer un filtre trop restrictif
  pour une affaire sans histoire.

- **Sous 1024 px**, le fil passe sous le formulaire, comme le panneau du §5.10.

- **La barre de filtres SE REPLIE, elle ne défile pas** — décision prise après avoir regardé
  (`docs/JOURNAL.md` décision 212). Écrite d'abord avec un défilement horizontal dans son
  conteneur, elle laissait « Cycle de vie » **coupé hors du panneau à 1440 px** : la colonne de
  droite est étroite quelle que soit la largeur de l'écran. Un contrôle dont la dernière option
  sort du cadre est un contrôle qui **cache** une option, ce que le §7 admet pour un tableau ou un
  board — dont on sait qu'ils défilent — mais pas pour cinq bascules.

### 5.12 Connexion et identité de session — `CRM-009`

L'écran de connexion est une surface autonome, sans barre latérale ni onglets : tant qu'aucune
session n'existe, ces repères ne contiennent que le refus anonyme et détournent de l'action utile.

- Fond `--color-bg`, carte `--color-surface` de largeur maximale correspondant à un formulaire
  court, `--radius-lg`, bordure `--color-border` et ombre de carte existante. Aucun nouveau jeton.
- Nom du produit, titre H1 « Se connecter », phrase courte expliquant que l'accès est réservé aux
  comptes invités, puis les deux champs du §5.7 et un bouton primaire sur toute la largeur.
- Aucun lien « créer un compte » : l'inscription libre est refusée par le serveur. Aucun bouton
  inerte « mot de passe oublié » tant que son parcours d'interface n'est pas livré.
- L'erreur se place entre les champs et l'action, dans une surface `--color-danger-soft`, texte
  `--color-danger-on-soft`, avec l'icône Lucide `TriangleAlert` et `role="alert"`. Elle ne déplace
  pas le titre et reste lisible quand le texte gagne 40 %.
- À partir de 768 px, la carte reste centrée dans les deux axes ; sous ce palier, elle occupe la
  largeur disponible avec 16 px de marge et reste alignée en haut pour que le clavier virtuel ne
  masque pas l'action.
- L'en-tête connecté place l'adresse de session en texte secondaire puis l'action discrète
  « Se déconnecter ». Sous 768 px, l'adresse passe en `sr-only` avant le titre de route ; l'action
  reste une cible d'au moins 40 px avec un libellé accessible complet.
- La restauration initiale de session emploie une carte squelette de même forme que l'écran de
  connexion. Aucun spinner plein écran (§5.8).

La couleur n'indique jamais seule un refus, tous les champs portent leur libellé visible, et
l'ordre de tabulation suit l'ordre visuel : email, mot de passe, action.

### 5.13 Administration de l'arborescence — `CRM-075`

Première surface d'administration du produit. Ce que l'écran **fait** — gestes, requêtes, refus — est
spécifié dans `docs/SPEC-administration-arborescence.md` ; les règles ci-dessous ne disent que de
quoi il a l'air.

- **Une arborescence est une liste imbriquée, pas un tableau.** Le §5.9 régit un tableau de données
  — colonnes comparables, tri, balayage en diagonale. Ici les deux niveaux n'ont pas les mêmes
  colonnes (un channel porte un workflow, un track une couleur et une icône), et les aligner
  produirait des cellules vides porteuses d'aucune information. Le patron est donc `ul` / `li`
  imbriqués, avec les hauteurs de ligne et les séparateurs du §5.9 — `--size-target`, bordure basse
  `--color-border`, survol `--color-hover`, aucune zébrure.

- **Le dépliage est un `button` portant `aria-expanded`**, distinct de tout autre élément
  interactif de la ligne. Une ligne entièrement cliquable rendrait ambiguë la cible d'un clic qui
  porte déjà cinq commandes.

- **Le groupe d'actions d'une ligne est une barre de boutons discrets** (§5.5, taille compacte,
  hauteur `--size-target` conservée), **toujours visibles** — jamais au survol seul. Le §5.10
  autorise l'apparition au survol pour deux actions accompagnant une métadonnée ; ici les commandes
  sont l'objet même de l'écran, et les masquer obligerait à survoler chaque ligne pour savoir ce que
  l'on peut faire.

- **Les commandes de réordonnancement sont désactivées aux extrémités, jamais masquées** (§8) : leur
  `title` et leur nom accessible disent pourquoi. Une commande qui disparaît en tête de liste fait
  sauter le groupe d'actions d'une ligne à l'autre, et l'œil perd la colonne.

- **Les formulaires de création et de renommage, et la confirmation d'archivage, vivent dans le flux
  du document** — à la place de la ligne concernée, ou sous l'en-tête pour une création. **Aucune
  modale** : le §5 n'en déclare aucune, et `CRM-043` a déjà tranché ce cas (§5.10, « la confirmation
  n'est pas une modale »). Une surface qui recouvre l'écran demanderait un piège de focus, une
  gestion d'`Échap` et le voile `--color-veil` — trois mécanismes qu'aucune unité n'a spécifiés.

- **Ouvrir un formulaire déplace le focus dans son premier champ**, et le fermer le rend à la
  commande qui l'a ouvert. Sans le retour, activer « Annuler » au clavier laisse le focus sur un
  bouton qui vient de disparaître — le défaut que le §5.10 a déjà trouvé par la preuve clavier.

- **Un objet archivé porte une mention textuelle « Archivé »**, jamais une seule teinte ni une seule
  opacité (§1). Sa ligne conserve la même hauteur : un archivé grisé et rétréci se lirait comme une
  panne d'affichage.

- **Le libellé d'un track conserve sa pilule** (§5.5 bis) — icône, couleur douce, texte à la
  déclinaison lisible (§12.5). L'écran d'administration montre l'objet tel que la barre latérale le
  montrera, sans quoi choisir une couleur reviendrait à choisir à l'aveugle.

- **Les quatre états du §5.8 sont traités, plus le refus en écriture** : une alerte
  `--color-danger-soft` / `--color-danger-on-soft` avec `role="alert"`, placée **dans le formulaire
  concerné** et non en tête d'écran, pour que le refus soit lu près du champ qui l'a causé.

- **La mise à la corbeille est une SIXIÈME commande, distincte de l'archivage** — `CRM-077`,
  `docs/SPEC-corbeille.md` §4 bis. Icône `Trash2`, même bouton discret compact que les cinq autres,
  et surtout **pas la même que `Archive`** : les deux états sont indépendants (§3.1 de la
  spécification), et une icône commune aurait dit le contraire.

  - **Elle reste offerte sur une ligne archivée**, là où renommer et réordonner disparaissent. Le
    motif est le même dans les deux sens : ces deux-là n'ont aucun effet observable sur un objet
    masqué, alors que le retrait en a un — l'objet quitte cet écran pour la corbeille.
  - **Sa confirmation est un bloc distinct de celle de l'archivage**, dans le flux du document comme
    elle, mais avec sa propre question et son propre corps. Les fondre en une confirmation
    paramétrée aurait laissé lire « archivé » et « retiré » comme un seul état.
  - **La confirmation porte l'énumération de ce qui devient inaccessible** — « 3 channels »,
    « 27 affaires » —, dans les quatre états du §5.15 : en cours de mesure, un compte, aucun objet,
    et **n'a pas pu être mesuré**. Un blanc se lirait comme un zéro, et « 0 channel » se lit deux
    fois pour comprendre qu'il n'y a rien.
  - **Aucun de ces quatre états n'éteint la commande de confirmation.** L'énumération informe, elle
    ne garde pas : la refuser sur un compte manquant donnerait à un nombre la valeur d'une
    autorisation, alors que le compte est celui de l'appelant et n'a jamais prétendu à
    l'exhaustivité.

### 5.14 État de la messagerie — `CRM-059`

Ce que l'écran **lit** — deux requêtes, sous les RLS déjà posées par `CRM-052` et `CRM-058` — est
spécifié en détail par `docs/SPEC-mail-subsystem.md` §20.11 ; les règles ci-dessous ne disent que
de quoi il a l'air.

- **Le tableau des comptes suit le §5.9**, pas le §5.13 : les colonnes sont les mêmes pour chaque
  ligne (boîte, dernière relève, dernier incident), contrairement à l'arborescence où un track et
  un channel ne portent pas les mêmes attributs.
- **« Jamais relevée » est un texte, pas une cellule vide** : le §5.9 réserve la cellule vide à une
  donnée qui n'existe pas pour cette ligne ; l'absence de relève est un fait à nommer.
- **Les six codes d'incident sont traduits par un dictionnaire fermé**, jamais affichés bruts —
  même principe que le classement des refus de `CRM-075` (§5.13, `docs/SPEC-mail-subsystem.md`
  §20.11.4) : un code d'API n'est pas un texte pour un humain.
- **Les deux compteurs de la file sortante sont un chiffre et un libellé**, sans pilule ni couleur
  d'alerte — même sobriété que les compteurs de colonne du board (§5.2 bis). Aucune règle du
  produit n'associe une urgence à un compte en échec ; l'écran n'en invente pas une.
- **Aucune action, aucune modale** : l'écran lit, il n'agit pas — voir §20.11.7.

### 5.15 Éditeur de workflows — `CRM-076`

Deuxième surface d'administration, et la première à rendre un **graphe**. Ce que l'écran fait —
lectures, gestes, refus — est spécifié par `docs/SPEC-workflow-engine.md` §7 bis ; les règles
ci-dessous ne disent que de quoi il a l'air. Tout ce que le §5.13 pose pour l'arborescence vaut ici
sans être répété : barre de boutons discrets toujours visibles, commandes désactivées jamais
masquées, formulaires et confirmations dans le flux du document, focus entrant dans le premier
champ, alerte de refus dans le bloc concerné.

- **Le graphe se rend en listes groupées, pas en diagramme.** Un canevas de nœuds et d'arêtes
  demanderait une mise en page automatique, un zoom, une navigation clavier à inventer et un
  équivalent textuel pour les lecteurs d'écran — quatre mécanismes qu'aucune unité n'a spécifiés.
  Le patron retenu est une `ol` d'étapes, chacune portant la `ul` de **ses sorties**. Il se lit à
  la voix, se parcourt au clavier sans code supplémentaire, et dit la même chose.

- **Le sens de lecture d'une arête est porté par un mot, pas par la seule flèche.** Chaque sortie
  s'écrit « Vers <étape> » et non « <étape> » précédée d'une icône : l'icône `ArrowRight` est
  décorative (`aria-hidden`), et une ligne dont le sens ne tiendrait qu'à elle serait ambiguë hors
  contexte visuel.

- **Une étape sans sortie porte une phrase, jamais un vide.** Un groupe vide se lirait comme un
  défaut d'affichage ; le cul-de-sac est une information du graphe, et l'écran l'écrit.

- **Le libellé d'une étape apparaît deux fois — dans sa ligne, puis comme titre de son groupe
  d'arêtes — et c'est voulu.** Le bloc des transitions serait illisible s'il désignait ses groupes
  autrement que la liste juste au-dessus. La conséquence pratique est pour les preuves : une
  assertion sur un libellé d'étape se scope au bloc qu'elle vise.

- **Le motif exigé est une mention textuelle** — « Motif exigé », pilule `--color-accent-soft` /
  `--color-accent-on-soft` avec son icône —, jamais une teinte seule (§1). C'est une obligation
  faite à l'utilisateur d'une affaire, pas une nuance décorative.

- **Un libellé de bouton absent est nommé, pas laissé vide** : la ligne écrit « Libellé de l'étape
  d'arrivée » en texte secondaire. Le §2.5 du moteur pose qu'une valeur absente veut dire « prendre
  celle de l'objet parent » ; l'écran le dit au lieu de laisser croire à un oubli.

- **Le bloc des arêtes est SOUS celui des étapes, dans la même colonne**, jamais à côté. Les deux
  décrivent le même workflow et se lisent dans cet ordre : on ne relie pas des étapes qu'on n'a pas
  encore choisies. Aux paliers étroits du §7, les lignes se replient et le groupe d'actions passe à
  la ligne suivante — la hauteur `--size-target` des cibles est conservée.

**Les champs du formulaire — troisième tranche, `docs/SPEC-workflow-engine.md` §7 bis.10.** Un
troisième bloc suit les arêtes dans la même colonne, par la même règle d'ordre : on ne dessine pas
le formulaire d'un workflow avant d'en avoir posé les étapes et les chemins.

- **La clé d'un champ se rend en `code`**, sur `--color-hover`, à côté de son libellé. C'est un
  identifiant technique que les exports citent, et l'écrire dans la même graisse que le libellé
  laisserait croire à un second nom lisible.

- **Un champ archivé est NOMMÉ, jamais seulement grisé.** Il porte la pilule « Archivé »
  `--color-accent-soft` / `--color-accent-on-soft` avec son icône `Archive`, et il **reste dans la
  liste** à sa position. L'archivage est le seul retrait que le produit connaisse — aucune
  suppression n'existe (§2.7 du composeur) —, donc le masquer rendrait la restauration
  introuvable. La règle du §1 s'applique : la couleur seule ne dit rien, le mot le dit.

- **Archiver et restaurer sont deux commandes distinctes, jamais une bascule.** `Archive` et
  `ArchiveRestore` occupent la même place dans la barre d'actions, et une seule des deux est rendue
  selon l'état. Leur `aria-label` nomme le geste ET le champ ; à la vue, c'est la pilule « Archivé »
  de la ligne qui lève l'ambiguïté entre deux icônes proches.

- **Un champ à choix édite ses choix dans un `fieldset`, jamais dans une zone de texte JSON.** Deux
  colonnes — clé, libellé —, une commande de retrait par ligne, une commande d'ajout sous la liste.
  Le motif n'est pas cosmétique : la base n'assure ni la forme `{key, label}` ni l'unicité des
  clés, et une saisie libre rendrait la faute probable là où personne ne la rattrape.

- **Une valeur qui ne se modifie plus se rend en PHRASE, jamais en champ désactivé.** La clé et le
  type d'un champ existant s'écrivent « Clé : … Elle ne se modifie pas : … » en texte secondaire.
  Un champ grisé pose la question « pourquoi ? » sans y répondre et invite à chercher le moyen de
  le réactiver ; la phrase donne le motif et la manœuvre de remplacement.

**La grille champ × étape — quatrième tranche, `docs/SPEC-workflow-engine.md` §7 bis.11.** Un
quatrième bloc suit les champs dans la même colonne, par la même règle d'ordre : on ne règle pas la
visibilité de champs qu'on n'a pas déclarés.

- **C'est le §5.9 qui s'applique, pas le §5.13.** `table`, `thead`, `th scope="col"` pour les
  étapes et `th scope="row"` pour les champs. Le motif du §5.9 vaut ici plus qu'ailleurs : l'état
  d'une case ne se lit qu'en sachant de quel couple on parle, et une grille de `div` priverait un
  lecteur d'écran de l'en-tête rappelé à chaque cellule.

- **Le libellé accessible d'une case nomme le champ ET l'étape**, jamais « visibilité » seul. Sept
  colonnes de listes anonymes seraient indéchiffrables à la voix, et l'en-tête de colonne ne suffit
  pas : il est annoncé à l'entrée dans la cellule, pas au moment où le contrôle prend le focus.

- **Une case porte une largeur minimale, et ce n'est pas cosmétique.** Sans elle, la liste se
  rétrécit à la largeur de l'en-tête de sa colonne et son état devient illisible — « Par dé… »,
  « Aff… » —, c'est-à-dire précisément l'information que la grille existe pour donner. Mesuré à la
  capture du 2026-08-15. Le tableau s'élargit donc, et **défile dans son propre conteneur** (§7) ;
  la première colonne reste collée à gauche pour que la ligne garde son nom.

- **Aucun bouton d'enregistrement, et c'est une conséquence du modèle.** Une case est une ligne
  entière de la base — la clé primaire est le couple —, donc chaque changement est déjà atomique et
  il n'existe aucune saisie partielle à annuler. Un bouton par case ajouterait quarante-deux
  commandes à un tableau qui en compte déjà quarante-deux.

- **Un état par défaut se NOMME « Par défaut », et sa parenté avec « Affiché » s'écrit sous le
  tableau**, pas dans l'option. Le §1 vaut ici : deux états qui produisent le même formulaire ne se
  distinguent pas par une nuance, ils se distinguent par une phrase.

**Les exigences de transition — cinquième tranche, `docs/SPEC-workflow-engine.md` §7 bis.12.** Un
cinquième bloc suit la grille dans la même colonne, par la même règle d'ordre : on n'ajoute pas
d'exigence propre à une arête avant d'avoir vu ce que les règles exigent déjà.

- **Ce bloc revient aux listes du §5.13, pas au `table` du §5.9**, et la différence de patron avec
  la grille juste au-dessus est délibérée. La grille croise deux dimensions et chaque case a la
  même forme ; ici chaque arête porte une liste de longueur libre, souvent vide, dont les entrées
  n'ont pas toutes les mêmes commandes. Un tableau aurait eu autant de colonnes que la plus longue
  liste, et des cellules vides partout ailleurs.

- **Une arête est titrée « départ vers arrivée », jamais par son seul libellé.** Cinq arêtes du
  workflow par défaut s'appellent toutes « Marquer perdu » : un titre qui ne les distinguerait pas
  rendrait le bloc illisible, et le retrait porterait sur une arête que l'administrateur n'aurait
  pas identifiée. La même composition sert dans le libellé accessible des deux commandes.

- **L'origine d'une exigence est écrite sur sa ligne, jamais rendue par une teinte.** « exigé par la
  règle de l'étape d'arrivée », « exigé par cette transition », ou les deux. Le §1 s'applique :
  cette mention n'est pas une nuance, c'est ce qui détermine où l'exigence se modifie.

- **Une exigence héritée d'une règle ne porte AUCUNE commande de retrait**, et le bloc écrit où elle
  se modifie plutôt que d'exposer un bouton désactivé. C'est l'écart assumé à la règle du §5.13 —
  commande désactivée jamais masquée : ici le geste n'existe pas à cet endroit, il existe ailleurs.
  Un bouton grisé aurait suggéré un droit manquant ; la phrase de renvoi nomme le bon écran.

- **Une liaison sans effet est NOMMÉE, comme le champ archivé du §5.15 ci-dessus.** Une exigence qui
  porte sur une question archivée n'est demandée nulle part ; le bloc l'écrit sous l'arête, au
  singulier ou au pluriel avec son compte, et ne la retire pas de la base.

- **Une arête sans exigence porte une phrase, jamais un vide** — même règle que le cul-de-sac du
  graphe plus haut : une liste vide se lirait comme un défaut d'affichage.

**La prévisualisation des effets — sixième tranche, `docs/SPEC-workflow-engine.md` §7 bis.13.** Elle
n'ajoute pas de bloc : elle s'insère dans les deux gestes qui peuvent bloquer une affaire.

- **Seul le geste qui CONTRAINT demande une confirmation.** Régler une case sur « Exigé » ouvre une
  confirmation ; « Par défaut », « Masqué » et « Affiché » restent immédiats. La règle générale est
  celle du §6 — confirmer les gestes aux conséquences —, et son application ici est une mesure de
  praticabilité : imposer une confirmation aux quarante-deux cases aurait rendu la grille
  inutilisable pour des réglages dont aucun ne contraint personne.

- **La confirmation d'une exigence n'est PAS teintée de danger.** Son bouton d'action est
  `primaire`, jamais `danger` : poser une exigence n'efface rien, et la teinte de danger est
  réservée à ce qui détruit (§1, §6). Elle se distingue en cela de `ConfirmationRetrait`, dont elle
  ne réutilise pas le patron.

- **La case en attente montre le choix EN COURS, pas l'état enregistré.** Sans cette surcharge, le
  rendu contrôlé ramènerait la case à son état d'avant et la grille démentirait la confirmation
  affichée juste en dessous.

- **La confirmation se place SOUS le tableau, dans le flux.** Une case fait huit rem de large : y
  loger deux boutons et deux phrases aurait disloqué la grille entière. C'est la même règle
  d'ancrage que les autres confirmations de l'écran — dans le flux du document, jamais en modale.

- **Un compte nul se NOMME.** « Aucune affaire en cours n'est concernée » est une phrase ; un bloc
  muet se lirait comme une mesure qui n'a pas abouti. Et « en cours de mesure » se distingue de
  « n'a pas pu être mesuré » : deux états, deux textes.

- **Une mesure indisponible n'éteint jamais la commande.** Le compte est une aide à la décision, la
  garde est ailleurs (backend). Désactiver le bouton aurait fait passer un défaut de mesure pour un
  refus de droit.

**Les versions du workflow — `CRM-078`, cinquième tranche, `docs/SPEC-workflow-engine.md`
§7 ter.14.** Un sixième bloc suit les exigences dans la même colonne, par la même règle d'ordre : on
ne photographie pas une composition qu'on n'a pas composée. Ce que le bloc lit, envoie et refuse est
spécifié là-bas ; les règles ci-dessous ne disent que de quoi il a l'air.

- **La liste des versions est un tableau du §5.9, pas la liste imbriquée du §5.13.** Les trois
  colonnes — numéro, publication, note — sont les mêmes pour chaque ligne, et il n'y a rien à
  imbriquer : une version n'a pas d'enfant. Le numéro et la date sont des **données techniques**
  (§2), en monospace à chiffres tabulaires, alignées à droite comme au §5.9.

- **Une version ne porte AUCUNE commande de ligne.** C'est l'écart assumé avec les cinq blocs
  précédents de cet écran, et il vient du modèle : une version est immuable, sans mise à jour ni
  suppression (`docs/SPEC-workflow-engine.md` §7 ter.4). Une barre d'actions grisée enseignerait un
  geste qui n'existe pas. Les quatre gestes portent sur le **bloc**, pas sur la ligne.

- **« Auteur inconnu » est un texte, pas une cellule vide** — la règle du §5.16, reprise sans
  changement : un `published_by` détaché par la suppression d'un profil est un fait à nommer.

- **L'empreinte n'est pas affichée en entier.** Soixante-quatre caractères hexadécimaux occuperaient
  une colonne entière pour une donnée que personne ne lit à l'œil. Elle se rend **tronquée à douze
  caractères en `code`**, la valeur entière portée par `title`, exactement comme une cellule en
  ellipse du §5.9.

- **La comparaison rend six collections, chacune titrée, et une collection vide est NOMMÉE.** « Rien
  n'a changé de ce côté » est une phrase ; une liste vide se lirait comme un défaut de chargement —
  même règle que le cul-de-sac du graphe ci-dessus. Lorsque `identical` est vrai, le bloc écrit une
  seule phrase et **ne déroule pas** les six collections vides : il n'y a rien à parcourir.

- **Un ajout, un retrait et une modification se distinguent par un mot, jamais par une seule
  teinte** (§1). Ils portent en plus leur icône Lucide — `Plus`, `Minus`, `Pencil` — et une pilule
  `--color-success-soft`, `--color-danger-soft`, `--color-hover` avec leur déclinaison lisible
  (§12.5). Le mot reste le porteur de l'information.

- **Un attribut modifié s'écrit « avant → après », en deux valeurs distinctes**, jamais en une
  phrase construite par concaténation (§10). Une valeur absente d'un côté se rend « aucune valeur »
  et non un blanc, qui se lirait comme une valeur vide.

- **Le plan de remappage place les blocages EN TÊTE**, et l'ordre vient de la base
  (§7 ter.12.7) : l'écran ne retrie pas. Les compteurs de `summary` sont écrits en toutes lettres
  au-dessus de la liste, et la **troncature est écrite** — « 3 affaires listées sur 13 » —, jamais
  laissée à deviner.

- **Chaque étape retirée porte sa liste déroulante de destination, avec une option vide en tête**
  qui se nomme « Aucune instruction ». Un `select` sans option vide forcerait un choix par défaut, ce
  que le §7 ter.14.5 refuse : aucune destination n'est devinée.

- **La confirmation de restauration est dans le flux du document, jamais en modale** — la règle du
  §5.13 —, et son bouton d'action est **destructif** : le geste réécrit la structure et déplace des
  affaires. Elle se distingue en cela de la confirmation d'exigence ci-dessus, qui n'efface rien.

- **Le résultat d'une restauration reste affiché** : ses compteurs et le nom de son point de retour
  sont la seule trace visible du geste, et les faire disparaître au rechargement du graphe
  effacerait ce qu'on vient de faire.

**La création d'un workflow — `CRM-031`, `docs/SPEC-workflow-engine.md` §3 bis.** Elle n'ajoute pas
de bloc dans la colonne de droite : elle s'ancre **au-dessus de la liste de gauche**, là où se
choisit l'objet qu'elle crée.

- **Le geste est rendu DEUX FOIS, et la seconde est celle qui compte.** Au-dessus de la liste
  peuplée, et dans l'**état vide** de l'écran. Un état vide qui écrit « Aucun workflow dans cet
  espace de travail » sans offrir d'issue est un cul-de-sac, et c'est précisément l'état d'un
  workspace neuf (§3.2 du moteur). La règle générale du §5.8 — un état vide dit ce qui manque — se
  complète ici : sur une surface d'administration, il porte aussi le geste qui le comble.

- **Le sélecteur de track n'est pas grisé sous la portée « Global », il est ABSENT.** La règle du
  §5.15 s'applique — une valeur qui ne se modifie plus se rend en phrase, jamais en champ désactivé
  — et sa forme extrême ici : une valeur qui n'a aucun sens sous la portée choisie ne se rend pas
  du tout. Un `select` grisé poserait la question « pourquoi ? » là où la portée juste au-dessus y
  répond déjà.

- **Aucune case « par défaut ».** Elle échouerait en `23505` sur tout workspace qui a déjà son
  workflow par défaut, c'est-à-dire le cas normal (§3 bis.1). Le §1 vaut : on n'offre pas une
  commande dont on sait qu'elle sera refusée.

- **La liste de gauche est relue après un succès, jamais complétée localement**, et le workflow créé
  devient le workflow **choisi**. L'ordre de la liste — défaut d'abord, puis le nom — vient de la
  base ; une insertion optimiste le contredirait le temps d'un rendu.

**La mention de divergence — `CRM-032`, `docs/SPEC-workflow-engine.md` §4 bis.** Elle n'ajoute pas de
bloc dans la colonne de droite : elle s'écrit **au-dessus du bloc des étapes**, en tête de ce qui
décrit le workflow choisi.

- **C'est une phrase, jamais une pilule.** L'origine d'un workflow et l'état de sa source ne tiennent
  pas dans un mot, et le §1 vaut : une information de cette portée ne se rend pas par une teinte.
  Elle emprunte la forme de l'alerte « aucune étape initiale » du même écran — icône décorative,
  texte, `--color-accent-soft` / `--color-accent-on-soft` — lorsque la source a changé, et les
  jetons neutres `--color-hover` / `--color-text-2` lorsqu'elle n'a pas changé. Deux états, deux
  teintes, et le mot porte l'information dans les deux cas.

- **Un workflow sans origine ne rend RIEN**, pas même un état vide nommé. C'est l'écart assumé au
  §5.8 : n'être la copie de personne est le cas normal — le seed livre deux workflows dont un seul
  est une copie —, et un état vide sur le cas normal serait du bruit à chaque ouverture de l'écran.
  Le §5.8 garde toute sa force là où le vide est un manque ; ici il n'en est pas un.

- **Aucune commande.** Aucun « resynchroniser », aucun « comparer », pas même grisé : la copie est
  une divergence assumée, et le geste n'existe nulle part dans le produit
  (`docs/SPEC-workflow-engine.md` §4 bis.1). C'est la règle du §5.15 sur les exigences héritées,
  appliquée à un bloc entier — un bouton grisé enseignerait un geste qui n'existe pas.

- **La date affichée est celle de la COPIE, pas celle de la modification.** La date de dernière
  modification de la source ne voit pas les suppressions (`docs/SPEC-workflow-engine.md` §4.6) :
  l'afficher à côté de « la source a changé » ferait mentir l'écran. Le §12.5 vaut ici sous une
  autre forme — on n'affiche pas une donnée approchante parce qu'elle est disponible.

### 5.16 Corbeille — `CRM-077`

Quatrième surface d'administration, et la première dont l'**état vide est le cas normal**. Ce que
l'écran lit, envoie et refuse est spécifié par `docs/SPEC-corbeille.md` §4 ; les règles ci-dessous ne
disent que de quoi il a l'air.

- **Un tableau du §5.9, et non la liste imbriquée du §5.13.** La distinction est celle que le §5.14 a
  déjà tranchée : ici les trois types d'entrée — track, channel, affaire — portent **exactement les
  mêmes colonnes**, parce qu'on n'y montre pas ce qu'un objet *est* mais ce qui lui *est arrivé* : son
  type, son nom, qui l'a retiré, quand, et ce qu'il retient. Une arborescence n'aurait rien à
  imbriquer — un objet en corbeille n'est plus sous son parent, c'est tout le propos du §3.3.

- **Le type est un mot, jamais une icône seule.** « Track », « Channel », « Affaire » en toutes
  lettres dans sa propre colonne. Une icône seule demanderait une légende, et le §9 réserve les icônes
  à l'accompagnement d'un libellé, jamais à son remplacement.

- **La date de retrait est une donnée technique** : à droite, en chiffres tabulaires (§5.9, §2), au
  même format court que la dernière relève du §5.14. Deux dates du même produit ne se lisent pas dans
  deux formats.

- **« Auteur inconnu » est un texte, pas une cellule vide.** Même règle que « Jamais relevée »
  (§5.14), et elle a ici un cas réel dans le seed : un objet retiré par la clé de service naît sans
  auteur, et un profil supprimé détache le sien. La cellule vide du §5.9 reste réservée à une donnée
  qui n'existe pas pour la ligne ; un auteur non enregistré est un fait à nommer.

- **La colonne d'énumération porte trois états distincts, et aucun ne se confond avec un autre** : un
  compte, « en cours de mesure », et « n'a pas pu être mesuré ». C'est la règle que le §5.15 vient de
  poser pour la prévisualisation d'exigence, et pour le même motif — un blanc se lirait comme un zéro.
  Une affaire, qui n'a pas d'enfant, laisse la cellule **vide** : là, c'est bien une donnée qui
  n'existe pas pour la ligne.

- **La commande « Restaurer » est un bouton secondaire discret, toujours visible** (§5.13), jamais au
  survol seul, et **jamais désactivée d'avance**. Un enfant sous parent en corbeille porte la même
  commande que les autres : la garde est backend, et une commande éteinte par l'interface ferait
  passer une règle de la base pour une décision d'écran (`CLAUDE.md` §10).

- **Aucune confirmation avant de restaurer.** Le §6 exige une confirmation pour les actions
  **destructives** ; restaurer ne l'est pas, et c'est même le geste qui répare. En demander une
  banaliserait celle qui protège vraiment.

- **Le refus s'affiche dans la ligne concernée**, alerte `--color-danger-soft` /
  `--color-danger-on-soft` portant `role="alert"` — jamais en tête d'écran. Même ancrage que le §5.13 :
  un refus se lit près de ce qui l'a causé. Le succès, lui, est un `role="status"` en tête de la
  section, l'entrée ayant disparu du tableau.

- **L'état vide n'offre AUCUNE action.** C'est l'écart avec le §5.8, qui prévoit « message et
  action » : ici il n'y a rien à faire d'une corbeille vide, et un bouton y serait un chemin vers
  nulle part. Le message dit que l'état est sain, pas qu'il manque quelque chose.

### 5.17 Guide de démarrage — `CRM-079`

Première surface d'**accueil** du produit, et la seule dont le contenu est une liste de renvois vers
d'autres écrans. Ce que le guide lit, mesure et refuse de deviner est spécifié par
`docs/SPEC-onboarding.md` ; les règles ci-dessous ne disent que de quoi il a l'air.

- **Une `ol`, pas une liste de cartes.** Les étapes sont ordonnées — on ouvre un channel dans un
  track, une affaire dans un channel —, et le patron des listes du §5.13 porte déjà cet ordre avec
  ses hauteurs de ligne et ses séparateurs. Des cartes en grille, elles, ne se lisent dans aucun
  ordre.

- **L'état d'une étape est un MOT, jamais une icône ni une teinte seule** (§1). « Fait » accompagne
  `CircleCheck` en `--color-success` ; une étape à faire porte `Circle` en `--color-text-3` et le
  libellé de son action. Les deux icônes sont `aria-hidden` : elles doublent le texte, elles ne le
  remplacent pas (§9).

- **Une étape accomplie GARDE son lien**, elle ne devient pas une ligne morte. On ajoute un second
  track après le premier, et éteindre le chemin dès la première réussite ferait du guide un écran
  qui se referme derrière soi.

- **La progression s'écrit en toutes lettres** — « 3 étapes sur 5 » —, et la barre qui l'accompagne
  est `aria-hidden`. Une barre seule ne se lit ni à la voix, ni en cas de daltonisme, ni sur une
  capture d'écran étroite. C'est la même règle qu'au §5.15 pour les compteurs de `summary` : le
  chiffre est écrit, jamais laissé à deviner.

- **Aucune surimpression, aucun voile, aucune bulle d'aide flottante.** Le §5 ne déclare aucune
  modale — `CRM-043` puis `CRM-075` l'ont tranché deux fois —, et une visite guidée par surimpression
  demanderait un piège de focus, une gestion d'`Échap` et un voile, trois mécanismes qu'aucune unité
  n'a spécifiés. Le guide occupe la zone principale, dans le flux du document.

- **« Masquer le guide » est un bouton secondaire, jamais une croix seule.** Une croix sans libellé
  n'annonce ni ce qu'elle ferme ni pour combien de temps ; le libellé le dit, et la phrase sous le
  bouton dit où le retrouver.

- **Une étape non mesurable est NOMMÉE**, comme le compte manquant du §5.15 et de §5.16 : « cette
  étape n'a pas pu être vérifiée » est une phrase, un blanc se lirait comme « à faire ». Elle
  conserve son lien : une mesure indisponible n'est pas un refus de droit.

- **Le guide ne s'affiche jamais à la place d'un chargement.** Tant qu'une mesure est en vol,
  l'écran rend un squelette **par étape**, à la forme de la ligne attendue (§5.8) — jamais l'état
  vide du board, qui écrirait « aucun board » à qui en a.

### 5.18 Administration du catalogue de nœuds — `CRM-030`

Cinquième surface d'administration, et la première dont l'objet est une **liste plate**. Ce que
l'écran lit, envoie et refuse est spécifié par `docs/SPEC-workflow-engine.md` §2 bis ; les règles
ci-dessous ne disent que de quoi il a l'air. Tout ce que le §5.13 pose vaut ici sans être répété :
barre de boutons discrets toujours visibles, formulaires et confirmations dans le flux du document
— **aucune modale** —, focus entrant dans le premier champ et rendu à la commande qui l'a ouvert,
alerte de refus dans le bloc concerné.

- **Une `ul` de lignes, ni tableau ni arborescence.** Le §5.9 régit des colonnes comparables et le
  §5.13 une imbrication ; ici il n'y a qu'un niveau, et les attributs d'un nœud — type, couleur,
  probabilité, seuil — ne se comparent pas colonne par colonne, ils **qualifient** le nœud. Les
  hauteurs de ligne et les séparateurs du §5.9 sont conservés : `--size-target`, bordure basse
  `--color-border`, survol `--color-hover`, aucune zébrure.

- **Le libellé d'un nœud porte sa pilule de couleur** (§5.6, §12.5), avec la même correspondance de
  jetons que la pilule de track du §5.5 bis — c'est la même donnée, `brand`, `success`, `accent`,
  `danger`, `neutral`, et une seconde correspondance divergerait au premier changement. L'écran
  montre le nœud tel que le board le montrera : choisir une couleur à l'aveugle n'aurait aucun sens.

- **La clé se rend en `code`** sur `--color-hover`, à côté du libellé — exactement la règle du §5.15
  pour la clé d'un champ de formulaire, et pour le même motif : c'est un identifiant technique que
  l'analytique cite, et l'écrire dans la graisse du libellé laisserait croire à un second nom.

- **Le type est un MOT, jamais une teinte** (§1). « Ouvert », « Gagné », « Perdu » en toutes
  lettres. `won` et `lost` déterminent l'analytique de conversion (§2.9 du moteur) : les laisser
  reposer sur la couleur de la pilule, qu'un administrateur choisit librement, rendrait deux nœuds
  indiscernables dès qu'ils partagent une couleur.

- **Un nœud archivé porte la pilule « Archivé »** `--color-accent-soft` / `--color-accent-on-soft`
  avec son icône `Archive`, et **reste dans la liste à sa position** — la règle du §5.15 pour un
  champ archivé, reprise sans changement : l'archivage est le seul retrait que le produit connaisse,
  et masquer le nœud rendrait sa restauration introuvable.

- **Archiver et désarchiver sont deux commandes distinctes, jamais une bascule** (§5.15) :
  `Archive` et `ArchiveRestore` occupent la même place, une seule des deux est rendue selon l'état,
  et leur `aria-label` nomme le geste ET le nœud.

- **La confirmation d'archivage est dans le flux, et son bouton est destructif** (§5.13). Elle
  nomme le nœud. **Le désarchivage n'en demande aucune** : la règle du §5.16 pour « Restaurer » —
  le §6 réserve la confirmation à ce qui détruit, et en demander une pour le geste qui répare
  banaliserait celle qui protège.

- **Le refus d'un nœud occupé est une alerte, jamais une commande éteinte.** La commande
  « Archiver » n'est **jamais désactivée d'avance** (§5.16) : l'écran ne mesure pas l'occupation, la
  base la mesure, et un bouton grisé ferait passer une règle de la base pour une décision d'écran
  (`CLAUDE.md` §10). L'alerte `--color-danger-soft` / `--color-danger-on-soft` avec `role="alert"`
  s'affiche **dans la ligne concernée**, écrit le nombre d'affaires en toutes lettres et nomme la
  manœuvre — les déplacer d'abord.

- **La clé d'un nœud existant se rend en PHRASE, jamais en champ désactivé** (§5.15) : « Clé : …
  Elle ne se modifie pas : archivez ce nœud et créez-en un autre. » Un champ grisé pose la question
  « pourquoi ? » sans y répondre.

- **Un attribut facultatif non renseigné se rend vide dans la ligne** (§5.9), et son champ de
  formulaire reste vide — jamais `0`. La distinction entre « ne se prononce pas » et « vaut zéro »
  est une règle du produit (§2.5 du moteur), et un zéro affiché la détruirait à l'œil comme en base.

- **Les deux valeurs numériques sont des données techniques** (§2) : monospace, chiffres tabulaires,
  suffixées par leur unité — « 10 % », « 14 j » — dans leur propre élément, jamais accolées au
  nombre par un nœud de texte nu (§5.11, le défaut « Discussion1 »).

- **Monter et descendre sont deux commandes discrètes en tête du groupe d'actions**, `ArrowUp` et
  `ArrowDown` de Lucide, avant « Modifier » — la disposition exacte du §5.13, et l'ordre compte : les
  commandes d'ordre sont les mêmes sur les deux surfaces, et l'œil qui a appris l'une lit l'autre.
  Elles sont **désactivées aux extrémités, jamais masquées**, et leur `title` dit laquelle des deux
  causes s'applique — « déjà en tête de liste » n'est pas « les positions ne se distinguent plus »
  (§8, `docs/SPEC-workflow-engine.md` §2 ter.2).

  - **Elles disparaissent sur une ligne archivée**, comme « Modifier » et pour le même motif : le
    geste n'a aucun effet observable sur un nœud que les sélecteurs d'étape ignorent déjà. La ligne
    archivée reste en revanche **comptée comme voisine** par le calcul, puisqu'elle occupe une place
    à l'œil (`docs/SPEC-workflow-engine.md` §2 ter.3).

## 6. Interactions

- Retour visuel en moins de 100 ms sur tout clic ; transitions 150–250 ms `ease-out` ;
  `prefers-reduced-motion` respecté.
- Les actions destructives demandent une confirmation explicite nommant l'objet concerné.
- Les opérations longues (envoi d'email, import CSV, backfill) affichent une progression et
  restent interruptibles ou, à défaut, indiquent leur état réel.
- Le glisser-déposer d'une card est **optimiste**, mais un refus du backend replace la card à sa
  position d'origine et affiche la raison du refus.

## 7. Responsive

| Palier | Comportement |
|---|---|
| ≥ 1280 px | Barre latérale déployée, board multi-colonnes, détail de card en deux colonnes |
| 1024–1279 px | Barre latérale réduite aux icônes, détail de card en deux colonnes resserrées |
| 768–1023 px | Barre latérale en tiroir, détail de card empilé, inbox en pile |
| < 768 px | Navigation par tiroir, board défilable colonne par colonne avec ancrage |

Aucun contenu n'est masqué sans point d'accès. Les tableaux et les boards défilent dans leur
propre conteneur : la page ne défile jamais horizontalement.

## 8. Accessibilité

- Navigation clavier complète : la barre latérale, les onglets, les colonnes et les cards sont
  atteignables et actionnables sans souris. Le déplacement d'une card est possible au clavier
  via le menu de transitions.
- Points de repère sémantiques (`nav`, `main`, `aside`), titres hiérarchisés sans saut de niveau.
- Contrastes AA (4,5:1) vérifiés, y compris pour les badges colorés.
- Focus visible partout via `:focus-visible`.
- Cibles interactives ≥ 40 px.
- Les changements importants (card déplacée, email envoyé, erreur) sont annoncés par une région
  `aria-live` polie.
- Les états désactivés restent lisibles et expliquent pourquoi l'action est indisponible.

## 9. Icônes

- **Lucide** exclusivement, trait 2 px, 14–28 px, `aria-hidden` lorsqu'un libellé accompagne
  l'icône.
- **Aucun emoji** comme substitut d'icône dans l'application.
- Pastille d'icône : carré `--radius-md`, fond doux de la couleur de catégorie, icône à la
  couleur pleine.
- **Favicon du produit** : monogramme géométrique `P2`, carré arrondi `--color-brand`, lettre
  blanche et chiffre `--color-accent`. Sa forme tient à 16 px, sans détail décoratif ni police
  distante. Le SVG porte un titre accessible et le document HTML le référence explicitement : le
  navigateur ne doit jamais tenter un `/favicon.ico` absent ni polluer la console d'un `404`.

## 10. Internationalisation

Aucun texte visible n'est écrit en dur dans un composant : tout passe par des clés de traduction
stables. Langue par défaut : français. Les libellés métier (tracks, channels, nœuds, champs) sont
des **données**, pas des traductions. Les mises en page tolèrent des textes 40 % plus longs que
le français.

Cette règle est **exécutable** : `webapp/src/i18n/i18n.test.ts` la fait échouer. Le contrôle lit
l'**arbre syntaxique TypeScript** du composant, jamais son texte : un texte visible est un nœud
`JsxText`, une chaîne littérale rendue comme enfant de JSX, ou la valeur littérale d'un attribut
visible (`title`, `aria-label`, `placeholder`, `alt`). Une expression régulière ne sait pas faire
cette distinction, et celle qui tenait ce rôle comptait la queue d'un ternaire — `? undefined : (`
— pour un texte (INC-070, `docs/JOURNAL.md` décisions 296 et 381). **Aucune forme d'écriture n'est
donc proscrite pour accommoder le contrôle**, ce qui était la contrepartie de l'ancienne version.

## 11. Implémentation

- Les jetons sont déclarés une seule fois, en variables CSS sur `:root`, et exposés à Tailwind
  par la configuration du thème. Aucun hexadécimal dans un composant.
- **Les espaces de noms de Tailwind sont remis à zéro** (`--color-*: initial`, `--spacing`,
  `--text-*`, `--radius-*`, `--shadow-*`, `--breakpoint-*`) avant d'être redéfinis dans
  `webapp/src/styles/tokens.css`. Ce n'est pas une précaution de style : sans cela, la palette et
  l'échelle par défaut restent disponibles, et rien n'empêche d'écrire `bg-red-500` ou `p-7`.
  Remises à zéro, **ces classes n'existent pas**.
- Corollaire mesuré : une classe dont le jeton n'est pas déclaré n'est **pas engendrée du tout**,
  et en silence. C'est ainsi que `min-w-0` a disparu, avec la garde qui empêche une colonne de
  flex de déborder. Un contrôle du harnais (`scripts/lib/classes-css.mjs`) vérifie donc que
  **chaque classe citée par un composant existe dans le CSS produit**.
- L'échelle d'espacement comprend le **zéro** (`--spacing-0`), qui n'est pas une valeur
  d'espacement mais son absence, et sans lequel `min-w-0`, `min-h-0` et `gap-0` n'existent pas.
- Les composants du design system vivent dans `webapp/src/components/ui` et sont les seuls à
  définir des styles de base ; les composants métier les composent.
- Chaque composant partagé porte un commentaire `@spec` citant ce document et son unité de
  backlog.
- **Captures de référence** : `e2e/output/*.jpg` et vidéos `.webm`, produites depuis
  l'application réellement exécutée et observées à chaque livraison touchant l'interface.

## 12. Écarts propres au projet

### 12.1 Barre d'onglets : navigation par liens, non `tablist` — position motivée, `CRM-021`

`CRM-007` avait laissé cette barre en état vide faute de channels, en annonçant que « le patron
ARIA complet — `role="tab"`, `tabindex` glissant, flèches, `Home`, `Fin` — arrive avec les onglets
réels ». Les onglets réels sont arrivés avec `CRM-021`, et ce patron est **écarté**. L'écart cesse
donc d'être temporaire pour devenir une position motivée, ce qui n'est pas la même chose qu'un
écart refermé.

Motifs (`docs/JOURNAL.md`, décision 62) :

- un `tablist` décrit des panneaux qui s'échangent **dans la même page**, sans changer d'adresse.
  Nos onglets changent l'URL et le contenu principal ;
- les annoncer comme des onglets décrirait aux technologies d'assistance un comportement qui n'est
  pas celui du produit ;
- le `tabindex` glissant du patron `tablist` retirerait à l'utilisateur la navigation par `Tab`
  qu'un ensemble de liens lui donne naturellement.

Patron retenu : `nav` étiqueté + liste de liens, avec `aria-current="page"` sur l'onglet courant,
posé par `NavLink`. L'état actif se signale **en plus** par une bordure basse, faute de quoi
l'information reposerait sur la seule couleur (§1). Les deux états portent une bordure de même
épaisseur, pour que le texte ne se décale pas au changement d'onglet.

Lorsqu'un track n'a aucun channel, la barre affiche son état vide, comme avant.

### 12.2 Ordre de sacrifice dans l'en-tête sous 768 px — `CRM-007`

Sous le palier `md`, l'en-tête abandonne d'abord le **nom du produit** et le **contexte
d'espace de travail**, jamais le **titre de la route**. Motif : les deux premiers sont portés
ailleurs — barre latérale, onglet du navigateur —, le titre de la route ne se déduit de rien.
Défaut réellement observé sur une capture avant correction : à 390 px, le titre disparaissait au
profit du contexte, contre le §7 (« aucun contenu n'est masqué sans point d'accès »).

### 12.3 Libellés masqués visuellement, jamais retirés — `CRM-007`

Au palier « colonne d'icônes » (1024–1279 px) et lorsque la barre est repliée, les libellés de
navigation passent en `sr-only` au lieu d'être supprimés : réduire l'affichage ne doit pas réduire
l'information annoncée aux technologies d'assistance.

### 12.4 Pilules de track non cliquables — écart **refermé** par `CRM-021`

La barre latérale listait les tracks (§4) en éléments de liste, non en liens : « un track s'ouvre
sur ses channels, livrés par `CRM-021` : une pilule menant à une route vide serait une commande
morte […] Le lien arrivera avec la destination. »

La destination est arrivée. Chaque pilule est désormais un `NavLink` vers `/tracks/:slug`, qui
conserve son icône, sa couleur douce et son libellé (§5.5 bis). L'état actif **s'ajoute** à la
couleur du track — un anneau `--color-brand` — et ne la remplace pas : la couleur est une donnée,
et l'écraser ferait perdre au track actif ce qui l'identifie. `aria-current="page"` porte
l'information indépendamment du visuel.

### 12.5 Données réelles et réponses substituées — `CRM-020`, révisé par `CRM-009`

Sans session, les politiques RLS ne consentent aucune ligne et les captures anonymes montrent
l'état vide réel du backend. Depuis la livraison du parcours `CRM-009`, un membre peut se
connecter et les preuves de jonction exercent les données et écritures réelles sans substitution.

Une réponse réseau substituée reste admise pour isoler un état rare, une donnée longue ou un refus
précis. Elle doit être nommée et ne remplace jamais le parcours connecté correspondant. Injecter
directement un état interne reste interdit.

### 12.5 Texte des pilules de donnée : déclinaison assombrie, non couleur pleine — `CRM-020`, 2026-08-04

Le §5.6 demandait « texte à la couleur pleine » sur un fond de la même couleur à 10–22 %. Le §8
exige un contraste AA de 4,5:1 « y compris pour les badges colorés ». **Mesuré**, les deux règles
sont incompatibles pour trois jetons sur cinq :

| Jeton | Texte plein sur son fond doux | Contraste | §8 |
|---|---|---|---|
| `brand` | `#23468C` sur `#E9ECF4` | 7,64:1 | conforme |
| `success` | `#238C33` sur `#E9F4EB` | 3,82:1 | **échec** |
| `accent` | `#D9CF4A` sur `#F7F4D7` | 1,45:1 | **échec** |
| `danger` | `#F24141` sur `#FEECEC` | 3,29:1 | **échec** |
| `neutral` | `#4B5563` sur `#F3F4F6` | 6,87:1 | conforme |

**Comment les trois ont été trouvés, et pourquoi pas en même temps.** `accent`, à 1,45:1, est
illisible : il a sauté aux yeux sur une capture et a d'abord été corrigé seul, par un repli sur
l'encre. `success` et `danger` sont **lisibles sans être conformes** — ils ne se voient pas, ils se
mesurent. Ils ont survécu parce que la conformité AA était *déclarée* et non *mesurée* : aucune
preuve du dépôt ne calculait un contraste.

**Écart retenu :** le texte d'une pilule de donnée emploie `--color-*-on-soft`, le jeton conservant
sa teinte mais assombri jusqu'à tenir les 4,5:1 — 7,64 / 4,85 / 4,72 / 4,67. Une seule règle pour
les quatre jetons chromatiques, plutôt qu'un repli sur l'encre pour l'un et la couleur pleine pour
les autres : le tableau devra s'étendre aux badges, et une exception s'y propagerait mal.
`neutral` est inchangé — il emploie les neutres existants et tient déjà 6,87:1.

**La conformité est désormais mesurée, pas déclarée.** `e2e/ui/tracks.spec.ts` calcule le contraste
à partir des couleurs **réellement rendues**, en les peignant sur un canevas d'un pixel : lire
`getComputedStyle` serait faux, Chromium rendant les `color-mix` avec des canaux de 0 à 1 et les
couleurs littérales en octets. Les cinq jetons y sont exercés, y compris `danger` et `neutral` que
le seed n'emploie pas — un jeton que rien ne rend n'est jamais mesuré.

**Portée :** limitée aux pilules de track tant qu'INC-028 n'est pas tranchée. Les badges, liserés
de card et compteurs de colonne rencontreront la même contradiction et ne sont **pas** modifiés ici.

### 12.6 Le débordement horizontal doit être **signalé**, pas seulement possible — `CRM-021`, 2026-08-04

Le §4 demande que les onglets débordent « défilable, jamais tronqué **sans indication** ». Le §7
demande que « la page ne défile jamais horizontalement ». Les deux étaient satisfaites, et l'écran
était pourtant fautif : à 390 px, la barre d'onglets défilait bien dans son conteneur, mais le
dernier libellé était **coupé net au bord**, sans que rien ne signale qu'il y avait plus à voir.

Défaut trouvé **en regardant une capture**, pas en lisant un test : les deux règles étant vérifiées
séparément, aucune assertion ne pouvait l'attraper.

**Règle ajoutée :** tout conteneur en `overflow-x: auto` porte la classe `.indique-debordement-x`,
définie une seule fois dans `webapp/src/styles/app.css`. Elle emploie la technique des « ombres de
défilement » en CSS pur : deux dégradés attachés au **contenu** (`background-attachment: local`)
recouvrent deux dégradés attachés au **conteneur** (`scroll`). L'indication n'apparaît donc que
lorsqu'il y a réellement quelque chose de plus à voir, de ce côté-là — ce qu'un dégradé permanent
ne saurait pas faire, et sans écouter aucun événement `scroll` ou `resize`.

Les quatre dégradés partent des jetons `--color-bg` et `--color-border` : aucune valeur
hexadécimale n'entre dans un composant (§11).

**Portée :** la barre d'onglets, le board depuis `CRM-041`, **et la vue liste depuis `CRM-042`** —
les trois portent la même classe, comme cette entrée l'annonçait les deux fois. Le board y ajoute
`scroll-snap`, l'ancrage colonne par colonne que le §7 demande sous 768 px ; le tableau de la vue
liste ne l'ajoute pas, faute de colonne sur laquelle s'ancrer (§5.9).

Tout écart futur est consigné ici avec sa justification et sa date.
