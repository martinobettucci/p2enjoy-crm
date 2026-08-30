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
`--color-brand-soft-strong` est ce même fond doux poussé à **22 %**, pour un badge qui doit se
détacher d'une surface déjà teintée. `--color-white` `#FFFFFF` est le blanc pur, réservé au texte
posé **sur** un aplat de couleur — il n'est jamais un fond, `--color-surface` l'étant.
*Ces trois noms ont été ajoutés au document le 2026-08-18 : ils existaient dans les tokens sans
figurer ici (INC-149).*

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

**Tokens de typographie** — ajoutés le 2026-08-18 : le document décrivait ces valeurs en prose sans
jamais les nommer, si bien qu'un développeur cherchant `--text-h2` ne trouvait rien
(`docs/INCONSISTENCY_REPORT.md` INC-149).

| Token | Valeur | Emploi |
|---|---|---|
| `--font-sans` | `ui-sans-serif, system-ui, sans-serif` | toute l'interface |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | données techniques |
| `--text-h1` | 26 px | titre d'écran |
| `--text-h2` | 20 px | titre de section |
| `--text-h3` | 16 px | titre de bloc |
| `--text-xs` | 12 px | **plancher absolu**, jamais en dessous |
| `--text-base--line-height` | 1,55 | interligne du corps |
| `--leading-normal` | 1,55 | interligne courant |
| `--leading-tight` | 1,25 | titres et libellés courts |

## 3. Espacements et rayons

- Échelle d'espacement : 4, 8, 12, 16, 24, 32, 48 px. Aucune valeur intermédiaire.
- Rayons : `--radius-sm` 8 px (champs, boutons), `--radius-md` 10 px (pastilles d'icône),
  `--radius-lg` 14 px (cartes, modales), `rounded-full` (badges, pilules, avatars).
- Ombre de carte : `0 1px 3px rgb(0 0 0 / .06)`, légèrement renforcée au survol.

**Tokens d'espacement, d'ombre et de durée** — ajoutés le 2026-08-18 (INC-149). L'échelle est
**close** : le thème réinitialise l'espace de noms (`--spacing-*: initial`), si bien qu'aucune autre
valeur n'existe. Écrire `p-5` ne produit rien.

| Token | Valeur | | Token | Valeur |
|---|---|---|---|---|
| `--spacing-0` | 0 px | | `--spacing-4` | 16 px |
| `--spacing-1` | 4 px | | `--spacing-6` | 24 px |
| `--spacing-2` | 8 px | | `--spacing-8` | 32 px |
| `--spacing-3` | 12 px | | `--spacing-12` | 48 px |

| Token | Valeur | Emploi |
|---|---|---|
| `--shadow-card` | `0 1px 3px rgb(0 0 0 / 0.06)` | carte au repos |
| `--shadow-card-hover` | `0 2px 8px rgb(0 0 0 / 0.1)` | carte au survol |
| `--transition-duration-fast` | 150 ms | survol, focus, bascule |
| `--transition-duration-slow` | 250 ms | ouverture de panneau ou de modale |

**Tokens de dimension** — les largeurs structurantes des écrans :

| Token | Valeur | Emploi |
|---|---|---|
| `--size-target` | 40 px | **cible interactive minimale** (§8) |
| `--size-sidebar` | 248 px | barre latérale déployée |
| `--size-sidebar-icons` | 64 px | barre latérale repliée |
| `--size-inbox-folders` | 264 px | colonne des dossiers de la boîte |
| `--size-inbox-list` | 360 px | colonne de la liste des messages |
| `--size-placeholder` | 120 px | réserve d'un contenu absent |

**Tokens de rupture** — les trois seuils responsive (§7) :
`--breakpoint-md` 768 px, `--breakpoint-lg` 1024 px, `--breakpoint-xl` 1280 px.

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
│ Contacts     │                                                       │
│ Ma journée   │                                                       │
│ Réglages     │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
```

- **Barre latérale** : tracks en pilules, plus les entrées transverses (Inbox, **Contacts**,
  Objectifs, **Coûts**, Ma journée, Réglages). Repliable ;
  *« Coûts » a été ajouté le 2026-08-20 par `CRM-086` (`docs/SPEC-costs.md` §4.0 et §4.5) — voir
  §5.33. Une route de PREMIER NIVEAU pour le motif exact du carnet ci-dessous : un histogramme de
  coûts n'administre rien, il porte le travail.*
  *« Contacts » a été ajouté le 2026-08-18 par `CRM-060` (`docs/SPEC-contacts.md` §10.2). Le
  carnet est une route de PREMIER NIVEAU et non une section de `/reglages` : un contact est le
  matériau quotidien d'un commercial, au même titre qu'une affaire — ce que la base a déjà tranché
  en ouvrant son écriture au `business_developer` là où les tracks, les channels et les workflows
  restent à l'`admin`. Les cinq surfaces de `/reglages` administrent la structure du workspace ;
  le carnet n'administre rien, il travaille.* l'état de repli est une préférence de session, pas une donnée
  persistée sans consentement.
- **Onglets** : les channels du track courant, en **liens** de navigation et non en `tablist`
  (§12.1). Débordement horizontal défilable, jamais tronqué sans indication — l'indication est
  portée par `.indique-debordement-x` (§12.6).
  *La barre porte en outre, depuis le 2026-08-19 (`CRM-086`, `docs/SPEC-costs.md` §4.0), les
  **entrées transverses du track** — celles qui portent sur le track entier et non sur l'un de ses
  channels. Une seule aujourd'hui, « Coûts ». Elles vivent après les channels, dans leur propre
  `nav` étiquetée, séparées par un filet `--color-border` : mêlées aux onglets, elles se liraient
  comme un channel de plus sur une barre où tout le reste en est un. Elles sont rendues **même
  lorsque le track n'a aucun channel** — les budgets d'un track existent indépendamment de ses
  channels, et l'état vide de la barre, qui reste vrai, ne dit alors plus tout ce qu'elle propose.*
- **Board** : une colonne par étape, dans l'ordre `workflow_steps.position`. En-tête de colonne
  avec libellé, compteur, et montant cumulé lorsque le montant est utilisé.

## 5. Composants

### 5.1 Carte de card (board)

Carte blanche `--radius-lg`, bordure 1 px, **liseré supérieur de 3 px** à la couleur du nœud.
Contenu : titre (2 lignes maximum, ellipse), pastilles d'étiquettes, avatar du responsable,
montant si renseigné, indicateur de prochaine action, et pastille d'ancienneté dans l'étape
(neutre, puis `--color-danger` au-delà du seuil de relance).

Le glisser-déposer utilise une zone de saisie visible au clavier : chaque card expose aussi un
menu d'actions dont la **section des transitions** liste **uniquement les transitions déclarées**.
C'est la garantie que l'interface ne propose jamais un **déplacement** que le backend refuserait.

*Révisé le 2026-08-17 par `CRM-081` (§5.3 sexies).* Cette phrase écrivait « un menu d'actions
listant uniquement les transitions déclarées », et le menu ne portait effectivement rien d'autre.
Il porte désormais aussi le geste de sommeil, qui n'est la garde de rien : la garantie ci-dessus
vaut pour les déplacements, seul endroit où `move_card` refuserait ce que l'écran aurait proposé.

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

### 5.3 bis En-tête de la fiche d'affaire — `CRM-040`

Le §5.3 nomme depuis `CRM-000` « les champs d'entête (titre, responsable, montant, prochaine
action) » et « l'adresse email de la card […] en monospace, avec une action de copie et une
infobulle expliquant son usage ». Rien ne les rendait : la fiche livrée par `CRM-037` ouvrait
directement sur le formulaire. Ce que l'en-tête **lit** et **compose** est spécifié dans
`docs/SPEC-cards.md` §15 ; les règles ci-dessous ne disent que de quoi il a l'air.

- **Il est EN HAUT de la colonne gauche, au-dessus du formulaire.** L'identité de l'affaire se lit
  avant son dossier, et le bas de cette colonne est déjà pris par le geste de retrait (§5.3). Ordre
  de la colonne : en-tête, formulaire, bloc de corbeille.

- **Une donnée absente n'est PAS une ligne vide, et pas davantage un tiret.** La cellule vide du
  §5.9 vaut pour un tableau, où la colonne dit de quoi il s'agit ; ici la ligne entière disparaît
  pour le montant et la prochaine action. Le responsable fait exception et porte une **phrase** —
  « Aucun responsable » : n'avoir personne à qui s'adresser est un fait de l'affaire, alors qu'une
  affaire sans montant chiffré est le cas ordinaire d'un début de qualification.

- **Les données sont un couple terme / valeur, dans une `dl`.** « Montant » lu seul, puis un nombre
  lu seul, ne dit pas que l'un qualifie l'autre. C'est la même exigence que le libellé résolvant
  vers son contrôle au §5.7, transposée à une lecture.

- **Montant et échéance sont des données techniques** (§2) : monospace, chiffres tabulaires. Le
  code devise occupe **son propre élément** — jamais un nœud de texte accolé au nombre, défaut
  « Discussion1 » mesuré au §5.11.

- **L'avatar du responsable est décoratif ici**, à 32 px comme au §5.1, parce que le nom est écrit
  juste à côté. Un avatar portant son nom accessible en plus du nom visible ferait annoncer deux
  fois la même personne.

- **L'adresse est un `code`, et son explication est un TEXTE.** L'« infobulle » du §5.3 ne peut pas
  être seulement un `title` : une infobulle native n'apparaît ni au clavier, ni au toucher. La
  phrase d'usage est écrite sous l'adresse, en 13 px `--color-text-3`, dans la graduation du texte
  d'aide du §5.7 ; le `title` est conservé **en plus**, pour la souris.

- **La confirmation de copie remplace le libellé de la commande**, deux secondes, dans une région
  `role="status"` — la règle du §5.7 ter, « la confirmation remplace l'envoi, elle ne s'y ajoute
  pas », appliquée à un geste de lecture. Le bouton garde une largeur minimale pour que la ligne ne
  se décale pas, et **son échec est dit** : une copie refusée par le navigateur rend une alerte,
  jamais un silence.

- **Aucune commande de copie lorsqu'il n'y a pas d'adresse à copier**, et l'écran écrit alors
  « Adresse indisponible ». Une commande sans objet est une commande morte (§5.10) ; une adresse
  amputée de son domaine serait pire, elle serait fausse.

- **Une affaire archivée porte la pilule « Archivé »** `--color-accent-soft` /
  `--color-accent-on-soft` avec son icône `Archive`, à côté du titre — la règle du §5.15 pour un
  champ archivé et du §5.18 pour un nœud, reprise sans changement. Sans elle, la fiche d'une affaire
  close serait indistinguable de celle d'une affaire en cours.

### 5.3 ter Édition des champs d'en-tête — `CRM-040`

Le §5.3 bis dit de quoi l'en-tête a l'air en **lecture**. Ce que la tranche d'écriture envoie, refuse
et mesure est spécifié dans `docs/SPEC-cards.md` §15 bis ; les règles ci-dessous ne disent que de
quoi elle a l'air. Tout ce que le §5.7 ter pose pour un champ qui s'enregistre pour lui-même vaut ici
sans être répété : mention d'état sous le champ, trois mentions jamais deux à la fois, confirmation
qui remplace l'envoi, contrôle jamais désactivé, refus qui n'efface pas la saisie.

- **L'en-tête BASCULE entre lecture et édition ; il ne porte pas six contrôles en permanence.**
  L'identité de l'affaire se lit avant son dossier (§5.3 bis), et six contrôles permanents feraient
  ouvrir la fiche sur deux formulaires empilés. La bascule résout en outre ce que l'édition en place
  ne résout pas : une donnée absente n'a **pas de ligne** en lecture, et n'aurait donc aucun endroit
  où être saisie. En édition, les six contrôles sont tous rendus, vides compris.

- **La commande est « Modifier », secondaire compacte, icône `PencilLine`** — celle de la famille
  « Champs » du fil (§5.11), puisque c'est le même genre de fait. Elle porte `aria-expanded`, et son
  nom accessible nomme ce qu'elle modifie : « Modifier les informations de l'affaire ».

- **Aucun bouton d'enregistrement, et une commande « Terminer » qui n'envoie rien.** C'est le §5.7
  ter appliqué à l'en-tête : chaque champ écrit sa propre valeur dès qu'elle est arrêtée. « Terminer »
  revient à la lecture, elle ne valide pas — la nommer « Enregistrer » promettrait une écriture qui a
  déjà eu lieu.

- **Le focus entre dans le premier contrôle à l'ouverture, et revient à la commande à la fermeture**
  (§5.13). Les deux défauts que cette règle évite ont été mesurés au §5.10 par la preuve clavier.

- **La commande n'est jamais éteinte d'avance, quel que soit le rôle** — la règle du §5.3 et du
  §5.16. MESURÉ, un lecteur seul reçoit `200` et **zéro ligne** : ni un succès, ni une erreur. L'écran
  le dit en toutes lettres, exactement comme l'issue « sans effet » du §5.3. Annoncer « Enregistré »
  sur zéro ligne serait la simulation de succès que `CLAUDE.md` §18 interdit.

- **Le montant et la devise sont deux contrôles distincts, côte à côte**, et deux écritures
  distinctes. La devise est un champ de trois caractères, jamais une liste fermée : la base ne
  contraint que la **forme** du code, et en fermer une à l'écran interdirait une devise qu'elle
  accepte — le motif qui interdit déjà `style: 'currency'` au rendu (§5.3 bis).

- **Aucune garde de saisie ne double une contrainte de la base.** Pas de `required` sur le titre, pas
  de `min` sur le montant : un titre vide et un montant négatif sont **envoyés**, et c'est la base qui
  tranche (`CLAUDE.md` §10). Un montant négatif est d'ailleurs mesuré **accepté** — le refuser à
  l'écran poserait une règle de produit que personne n'a prise.

- **Une affaire archivée reste modifiable, et sa pilule ne devient pas un verrou.** MESURÉ, la base
  accepte l'écriture ; éteindre les contrôles ferait passer un état pour un refus qui n'existe pas.

### 5.3 quater Mise en sommeil d'une affaire — `CRM-081`

Ce que le geste envoie, refuse et trace est spécifié dans `docs/SPEC-cards.md` §16 et §16.11 ; les
règles ci-dessous ne disent que de quoi il a l'air.

- **La pastille « En sommeil » vit à côté du titre, avec la pilule « Archivé », et les deux
  coexistent.** Fond `--color-brand-soft`, texte `--color-brand`, icône `Moon`, `rounded-full` —
  la forme du §5.6, avec le jeton de la marque plutôt que celui de l'accent, qui dit déjà
  « archivé ». Une affaire peut être archivée **et** endormie ; masquer l'une derrière l'autre
  perdrait un fait.

- **Elle porte l'échéance, jamais le seul mot « En sommeil ».** « Jusqu'à quand » est la moitié de
  l'information : sans elle, la pastille dit qu'il faut aller chercher la date ailleurs.

- **Une échéance échue n'est pas un sommeil, et l'écran ne montre rien.** La colonne conserve sa
  valeur (`docs/SPEC-cards.md` §16.2), mais une affaire dont l'échéance est passée est une affaire
  ordinaire. Aucun état « sommeil expiré » n'est inventé.

- **Deux visages, un seul rendu à la fois.** « Mettre en sommeil » (icône `Moon`) sur une affaire
  éveillée, « Réveiller » (icône `Sun`) sur une affaire endormie. Secondaire compacte, à côté de
  « Modifier », dans la graduation du §5.5.

- **Le réveil n'ouvre aucun panneau et ne demande aucune confirmation.** Il n'a pas de paramètre, et
  il est réversible d'un geste. Une confirmation pour un geste réversible sans perte est un obstacle,
  non une sécurité.

- **La mise en sommeil ouvre un panneau sous l'en-tête**, jamais une modale : quatre échéances
  usuelles en boutons discrets, puis un champ d'échéance choisie et son bouton. La bascule est celle
  du §5.3 ter — le panneau remplace la commande, il ne s'y ajoute pas —, et `Échap` le referme en
  rendant le focus à la commande.

- **Aucune garde de saisie ne double la base** (§5.3 ter, sans changement) : le champ d'échéance n'a
  ni `min` ni `required`. Une échéance passée est **envoyée**, refusée par `snooze_date_in_past`, et
  le refus est écrit sous le champ en `role="alert"`, comme au §5.7.

- **La commande n'est jamais éteinte d'avance**, quel que soit le rôle. Un lecteur seul l'ouvre,
  appuie, et lit « Vous ne pouvez pas modifier cette affaire. »

- **Les deux événements du fil sont de la famille « Cycle de vie »** (§5.11), et leur détail est
  l'échéance en date courte. Aucune sixième bascule n'est ajoutée pour deux types.

### 5.3 quinquies Le sommeil dans le board et dans la vue liste — `CRM-081`

Ce que le filtre masque, ramène et compte est spécifié dans `docs/SPEC-cards.md` §16.12 ; les règles
ci-dessous ne disent que de quoi il a l'air.

- **La bascule est une case à cocher étiquetée, pas un bouton à deux états.** « Afficher les
  affaires en sommeil » se lit sans avoir à deviner ce que l'état courant signifie, là où un bouton
  unique laisse toujours l'ambiguïté entre « ce que je fais » et « ce qui est ». Elle porte
  l'icône `Moon` du §5.3 quater et respecte la cible de 40 px du §8.

- **Elle vit dans la barre de filtres de la vue liste, et dans une barre de même rôle au-dessus des
  colonnes du board.** Le board n'avait aucune barre : celle-ci n'en est pas une de plus, c'est la
  première, et elle ne porte que ce contrôle. Comme la barre de filtres du §5.9, elle reste **rendue
  y compris sur un écran vide** — elle est la cause possible de ce vide, et la masquer priverait
  l'utilisateur du seul geste qui l'en sort.

- **La pastille compacte porte l'icône et la date, jamais le mot seul.** Sur une carte de board et
  dans une ligne de tableau, la place n'admet pas « En sommeil jusqu'au 26/08/2026 » : la pastille
  rend `Moon` suivie de la date courte, et la phrase entière devient son **nom accessible**. Mêmes
  jetons qu'au §5.3 quater — `--color-brand-soft` et `--color-brand`, `rounded-full` —, en taille
  `text-xs` : c'est la même information, elle doit se reconnaître d'une vue à l'autre.

- **La densité du tableau ne bouge pas.** La pastille est `shrink-0` après le lien de la colonne
  « Affaire » ; le titre garde son ellipse et la ligne garde sa hauteur d'une seule ligne de texte
  (§5.9). Une pastille qui ferait passer une ligne sur deux lignes contredirait la densité
  maîtrisée que ce tableau tient depuis `CRM-042`.

- **Un état vide dû au sommeil porte son action.** « Aucune affaire éveillée dans ce channel » et
  « Toutes les affaires de ce channel sont en sommeil » offrent le geste qui les lève, selon le
  patron du §5.8 ; comme lui, l'action n'est alors **pas répétée** dans la barre.

### 5.3 sexies Le menu de la carte du board, et le sommeil qui s'y loge — `CRM-081`

Ce que le geste envoie, refuse et fait disparaître est spécifié dans `docs/SPEC-cards.md` §16.13 ;
les règles ci-dessous ne disent que de quoi il a l'air.

- **Le menu de la carte est le menu de ses ACTIONS, plus celui de ses seuls déplacements.** Son
  déclencheur porte « Actions » et n'est **jamais éteint** : une carte porte toujours au moins le
  geste de sommeil. C'est une mesure qui l'impose — une affaire d'étape terminale ne déclare aucune
  transition, et son menu éteint la privait de tout geste, alors qu'une affaire livrée est
  précisément celle qu'on range.

- **Le menu ouvert porte deux sections nommées**, dans cet ordre : les déplacements, puis le
  sommeil. Un séparateur de 1 px `--color-border` les distingue ; les titres de section sont en
  `text-xs` `--color-text-3`, comme les étiquettes de la barre de filtres du §5.9.

- **Quand aucune transition n'est déclarée, la phrase reste, et elle entre dans le menu.** « Aucun
  déplacement déclaré depuis cette étape » se lit désormais **dans** la section des déplacements,
  au lieu de tenir lieu de libellé à un bouton éteint. L'information est conservée, elle change de
  place — et ce qui l'accompagnait, l'extinction du menu entier, disparaît.

- **Les quatre échéances usuelles sont rendues dès l'ouverture**, en boutons discrets pleine
  largeur, sans second dévoilement. Un panneau ouvert dans un menu ouvert ferait trois niveaux pour
  un choix de quatre boutons. La fiche, elle, garde son panneau (§5.3 quater) : elle a la place, et
  elle porte aussi l'échéance choisie, que 288 px n'admettent pas.

- **« Réveiller » remplace les quatre boutons sur une affaire endormie**, icône `Sun`, sans
  confirmation — même règle qu'au §5.3 quater, pour le même motif.

- **Le refus est écrit dans le menu, et le menu reste ouvert.** Mention `role="alert"` en
  `--color-danger` sous la section, mot pour mot celle de la fiche : un même refus ne se formule pas
  de deux façons selon l'écran d'où il a été demandé. Le succès, lui, referme le menu — la carte
  disparaît ou prend sa pastille, et le menu d'une carte disparue n'a rien à montrer.

- **Pendant le vol, les gestes de la section sont éteints et le bouton appuyé dit
  « Enregistrement… »** : deux appels concurrents sur la même carte feraient gagner le plus lent,
  exactement comme pour un déplacement (§6).

- **La carte ne bouge qu'après la réponse du serveur.** Le déplacement est optimiste (§6) ; le
  sommeil ne l'est pas, parce qu'il fait **disparaître** sa carte — une disparition qu'il faudrait
  annuler serait bien plus déroutante qu'une attente de quelques centaines de millisecondes.

### 5.3 septies Le sommeil d'un FIL dans l'inbox — `CRM-081`

Ce que le geste envoie, refuse et masque est spécifié dans `docs/SPEC-cards.md` §16.15 ; les règles
ci-dessous ne disent que de quoi il a l'air.

- **La pastille est celle du §5.3 quinquies, réemployée sans copie.** Icône `Moon`, date courte à
  l'œil, phrase entière en nom accessible. C'est la même information que sur une carte de board :
  elle doit se reconnaître d'une vue à l'autre, et une pastille propre à l'inbox divergerait au
  premier ajustement. Elle se pose après la date dans la ligne de liste, et dans l'en-tête du
  message ouvert.

- **La bascule est une case à cocher étiquetée**, « Afficher les fils en sommeil », dans l'en-tête
  du panneau de liste. Elle **reste rendue sur une liste vide** — elle est la cause possible de ce
  vide —, porte l'icône `Moon` et respecte la cible de 40 px du §8.

- **SON ÉTAT VIT DANS L'ADRESSE, sous la même clé `sommeil` que le board et la vue liste — ajouté le
  2026-08-29 par la tranche 3** (`docs/SPEC-cards.md` §16.17.1). Les trois écrans du produit qui
  portent cette bascule l'écrivent désormais de la même façon : valeur `visibles`, défaut jamais
  écrit, valeur inconnue repliée. L'inbox était le seul à la tenir dans un état de composant, si
  bien qu'un rechargement y perdait ce qu'on regardait — et deux écrans qui font la même chose ne
  peuvent pas la faire de deux façons. **Le mode vaut pour tous les dossiers de l'écran** : c'est
  une préférence d'affichage, non une désignation de ce qui est montré, et le §12.1 ne s'y applique
  pas (voir le critère écrit au §5.36).

- **Le geste vit dans le message ouvert, jamais dans la ligne de liste.** Une liste dont chaque
  ligne porte un bouton n'est plus une liste, et le §5.4 tient une densité que cette tranche ne
  défait pas. Deux visages, un seul rendu à la fois : « Mettre le fil en sommeil » (`Moon`) et
  « Réveiller le fil » (`Sun`), en secondaire compacte.

- **La mise en sommeil ouvre un panneau sous l'en-tête**, jamais une modale : quatre échéances
  usuelles en boutons discrets, puis un champ d'échéance et son bouton. Le panneau remplace la
  commande (§5.3 ter) et `Échap` le referme en rendant le focus à la commande. Le réveil, lui,
  n'ouvre rien et ne demande aucune confirmation — même règle qu'au §5.3 quater.

- **Le refus est écrit sous le champ en `role="alert"` et n'efface pas la saisie**, et il nomme
  l'objet qu'il vise : « Ce fil n'est plus disponible. » là où l'affaire disait « Cette affaire ».
  Un même refus se formule d'une seule façon, mais il ne se trompe pas de sujet.

- **Le message ouvert n'est jamais masqué par le filtre, sa LIGNE comprise.** Endormir le fil de ce
  qu'on lit ne fait rien disparaître : la ligne reste, marquée de sa pastille, et ne quitte la liste
  qu'au geste suivant. Vider l'écran sous le doigt de celui qui vient d'appuyer serait le punir de
  l'avoir fait, et laisserait la sélection désigner une ligne absente.

- **Un état vide dû au sommeil porte sa bascule**, selon le patron du §5.8 : « Tous les messages de
  ce dossier sont dans des fils en sommeil » offre le geste qui l'en sort, et l'action n'est alors
  pas répétée dans l'en-tête.

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

### 5.4 bis Le FIL dans l'inbox — `CRM-081`

Ce que le groupement énumère, désigne et compte est spécifié dans `docs/SPEC-cards.md` §16.16 ; les
règles ci-dessous ne disent que de quoi il a l'air.

- **La liste énumère des fils, pas des messages.** Une ligne porte le dernier expéditeur, l'objet et
  la date du **dernier** message du fil — jamais une date de fil, qui n'existe pas. Un fil d'un seul
  message rend **exactement** la ligne d'avant : le groupement ne se voit que là où il y a quelque
  chose à grouper.

- **Le compte est un badge neutre, et il n'apparaît qu'au-delà de un.** Il se pose entre l'objet et
  la date, en `--text-sm` `tabular-nums`, et son nom accessible est une phrase entière — « 2 messages
  dans ce fil » — parce qu'un chiffre nu ne dit pas ce qu'il compte. Un badge « 1 » serait du bruit :
  il dirait ce que l'absence de badge dit déjà.

- **La pastille de sommeil se pose une fois par ligne**, après la date, exactement comme au §5.3
  septies. Le fil étant désormais la ligne, la même information cesse d'être répétée sur chacun de
  ses messages.

- **Un fil de plusieurs messages porte un sélecteur dans le panneau de lecture**, sous l'en-tête :
  une liste de boutons, un par message, avec son expéditeur et sa date courte, dans **le même ordre
  que la liste** — le plus récent d'abord. Le message affiché porte `aria-current` ; deux ordres sur
  un même écran rendraient « la première ligne » ambiguë.

- **Le sélecteur est absent sur un fil d'un seul message.** Une liste d'un élément n'est pas un
  choix, et l'afficher quand même donnerait à croire qu'il manque quelque chose.

- **La ligne reste marquée tant que le message ouvert appartient à son fil**, y compris après un
  changement dans le sélecteur : une sélection qui s'efface quand on navigue à l'intérieur de ce
  qu'on a choisi désigne alors une ligne que rien ne montre (§5.4).

- **La ligne du fil ne se déplie pas.** Le sélecteur du panneau de lecture tient ce rôle ; deux
  endroits pour le même choix en feraient diverger un.

### 5.4 ter La SUGGESTION de classement dans l'inbox — `CRM-060`

Le §5.4 pose la règle depuis `CRM-000` : « un message non classé affiche l'action *Classer dans une
card* **et, le cas échéant, la suggestion proposée par le classement assisté, toujours présentée
comme une suggestion à confirmer** ». Elle n'était rendue par rien. Ce que le bloc lit, envoie et
refuse est spécifié par `docs/SPEC-contacts.md` §8.8 ; les règles ci-dessous ne disent que de quoi
il a l'air.

- **Il vit dans le pied du panneau de lecture, AU-DESSUS de la commande manuelle**, dans le visage
  « non classé » de ce pied. L'ordre porte un sens : la suggestion est le chemin court, la commande
  manuelle est celui qui marche toujours. Un indice placé après la commande se lirait une fois la
  liste déroulée, c'est-à-dire trop tard.

- **C'est une carte discrète, pas une alerte.** Surface `--color-surface`, `--radius-sm`, bordure
  `--color-border`, rembourrage 12 px — la carte du §5.10, réemployée. Aucune teinte de danger,
  aucune teinte d'accent : une suggestion n'est ni une erreur, ni un avertissement, et lui donner
  une couleur d'état lui ferait porter une urgence qu'elle n'a pas.

- **L'affaire est NOMMÉE et son titre est un LIEN vers sa fiche** — la pilule
  `--color-brand-soft` / `--color-brand` du message classé (§5.4), réemployée sans copie : c'est la
  même donnée, elle doit se reconnaître d'un visage à l'autre du même pied. Un indice qui ne
  nommerait pas sa cible ne serait pas un indice ; un nom sans lien obligerait à chercher l'affaire
  ailleurs pour la vérifier, or vérifier est ce que « à confirmer » demande.

- **La règle est écrite en toutes lettres, en 13 px `--color-text-2`** — « L'expéditeur est un
  contact rattaché à cette affaire. » Le §1 vaut ici comme partout : ni une icône, ni une teinte ne
  diraient d'où sort ce nom d'affaire, et un indice dont on ignore l'origine ne se confirme pas, il
  se subit. L'icône `Sparkles` — celle de la famille « Cycle de vie » du fil (§5.11) pour un fait
  que le produit a établi lui-même — **accompagne** le titre du bloc et ne le remplace pas (§9).

- **LE GESTE D'ACCEPTATION EST PRIMAIRE, ET LA COMMANDE MANUELLE PASSE ALORS EN SECONDAIRE.** Deux
  boutons primaires dans le même pied ne diraient plus lequel est le chemin principal (§5.5), et
  c'est le chemin court qui l'est quand un indice existe. La commande manuelle **reste rendue,
  reste atteignable, et retrouve sa variante primaire** dès qu'aucune suggestion n'est présentée :
  sa nature ne change pas, seule sa place dans la hiérarchie d'un pied qui porte deux actions.

- **Aucune date, aucun score, aucune confiance.** `suggested_at` daterait l'indice et non l'affaire,
  et ferait chercher un rafraîchissement qui n'existe pas ; la règle 3 ne produit aucune probabilité,
  elle exige « exactement une » affaire active. Afficher une nuance que la donnée ne porte pas est
  la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.

- **Le refus se lit DANS le bloc, en `role="alert"`, et le bloc reste rendu** (§5.13, §5.16) :
  disparaître sur un refus retirerait le seul endroit où lire la cause. Les quatre refus sont ceux
  du classement manuel, **mot pour mot** — un même refus ne se formule pas de deux façons selon le
  bouton qui l'a demandé (§5.3 sexies).

- **La commande n'est jamais éteinte d'avance, quel que soit le rôle** (§5.3, §5.13, §5.16, §5.21,
  sans exception) : l'écran ne calcule aucun droit, il appuie et traduit le refus.

- **Une suggestion dont l'affaire n'est pas lisible ne rend RIEN** — ni bloc, ni mention, ni
  identifiant. C'est la règle du §5.29 pour un bloc masqué et du §5.33 pour un budget masqué :
  l'écran ne nomme jamais ce qu'il cache. Écrire « une affaire vous est suggérée » divulguerait son
  existence par la bande.

- **Aucune suggestion dans la LISTE ni dans l'arborescence.** Le §5.4 bis tient une densité que ce
  bloc ne défait pas — une ligne porte un expéditeur, un objet et une date —, et le §5.3 septies a
  déjà tranché dans le même sens pour le geste de sommeil : ce qui aide à **décider** vit dans le
  message ouvert.

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : le bloc emprunte au §5.10 sa carte, au
  §5.4 sa pilule, au §5.11 son icône et au §5.5 ses variantes.

### 5.4 quater RETIRER un message de son affaire — `CRM-055` tranche 2

*`docs/SPEC-mail-subsystem.md` §16.5.5. La commande vit dans le pied du message ouvert, et
uniquement quand ce message est CLASSÉ : un message non classé n'a aucune affaire à quitter.*

- **En bas du pied, dans un bloc séparé par une bordure haute `--color-border`**, sous la pilule de
  l'affaire et sous le formulaire de réponse. Même place et même motif qu'au §5.3 quater : un
  retrait n'est pas ce qu'on vient faire sur un message.

- **La commande qui OUVRE la confirmation est secondaire, pas destructive**, et porte l'icône
  `MailX`. `Mail` dirait l'arrivée, `Trash2` dirait une destruction qui n'a pas lieu : le message
  survit au geste, il change seulement d'appartenance. Le §9 interdit qu'une icône serve deux
  objets, et c'est `MailX` qui distingue ce geste de la ligne « Message reçu » du §5.11.

- **La confirmation vit dans le flux, jamais en modale** — le §5 n'en déclare aucune, et le
  §5.3 quater a déjà tranché ce cas. Le focus y entre, et **revient à la commande** si l'on annule.

- **Elle porte DEUX phrases, et la seconde est le tout de ce chapitre.** La première dit ce qui
  n'arrive pas — rien n'est supprimé, le message repasse en non classé. La seconde nomme une
  CONSÉQUENCE possible : l'appelant qui ne voyait ce message que par son affaire cesse de le voir.
  **Elle énonce la condition, elle ne devine pas un rôle** : l'écran ne sait pas de quelles boîtes
  l'appelant répond, et le déduire ferait passer une décision de la base pour une décision d'écran.

- **Aucune commande n'est éteinte d'avance selon le rôle** — §5.3, §5.13, §5.16, §5.21, §5.23,
  §5.25, §5.27, §5.28, sans exception ici non plus. L'écran offre, envoie, et traduit le refus.

- **Le refus a son PROPRE dictionnaire**, distinct de celui du classement. Réemployer « Vous ne
  pouvez pas classer ce message dans cette affaire » sur un retrait décrirait le geste inverse de
  celui qui vient d'être tenté — c'est le défaut trouvé sur les objectifs et corrigé par la
  décision 535, et il ne se répète pas ici.

- **Aucune couleur, aucun jeton et aucune règle nouvelle** : le bloc emprunte au §5.3 quater sa
  grammaire de confirmation, au §5.5 ses variantes, et au §5.4 son pied de message.

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

### 5.7 ter Champ qui s'enregistre pour lui-même — `CRM-037`

Le formulaire d'une card n'a **aucun bouton d'enregistrement** : chaque champ écrit sa propre valeur
dès qu'elle est arrêtée (`docs/SPEC-form-composer.md` §4 bis.2 et §4 bis.3). Six règles visuelles en
découlent, et elles valent pour tout champ du produit adoptant ce mode.

- **La mention d'état vit sous le champ**, à la place et dans la graduation du texte d'aide du §5.7 :
  13 px, sous le contrôle, jamais en tête d'écran. Un état d'enregistrement se lit près de ce qu'il
  concerne (§5.13, §5.16).
- **Trois mentions, jamais deux à la fois** : « Enregistrement… » en `--color-text-3`,
  « Enregistré » en `--color-success`, le refus en `--color-danger-on-soft` sur `--color-danger-soft`
  avec son icône, comme toute erreur de champ du §5.7.
- **La confirmation remplace l'envoi**, elle ne s'y ajoute pas : deux mentions superposées feraient
  croire à deux écritures.
- **Le contrôle n'est jamais désactivé pendant l'envoi.** Un contrôle désactivé perd le focus du
  clavier, ce que le §5.13 interdit ; et l'écriture est trop courte pour qu'une attente soit
  lisible.
- **Un refus n'efface pas la saisie.** Elle reste à l'écran avec son explication : rejeter une saisie
  sans le dire est la « valeur par défaut trompeuse » que `CLAUDE.md` §18 interdit.
- **L'alerte de valeur manquante et l'alerte de refus coexistent.** Elles disent deux choses
  différentes — le champ est exigé, et la dernière écriture a échoué — et `aria-describedby` les
  cite toutes les deux (`docs/SPEC-form-composer.md` §4 bis.9).

Aucune couleur nouvelle : `--color-success` sert déjà aux pilules du §5.6, et le couple
danger/danger-soft aux erreurs du §5.7.

### 5.7 quater Champ exigé par un déplacement refusé — `CRM-037`

Le §5.7 signale un champ « obligatoire pour la transition en cours » par un astérisque et la mention
« requis pour passer à *<étape>* ». Il en manquait un second cas, que `CRM-041` a rendu possible : un
déplacement **refusé** pour champs manquants, dont l'utilisateur reprend la saisie sur la fiche
(`docs/SPEC-form-composer.md` §4 ter). Ce que cet écran **choisit** de mettre en évidence est
spécifié là-bas ; les règles ci-dessous ne disent que de quoi il a l'air.

- **La mise en évidence emploie `--color-brand`, jamais `--color-danger`.** Le champ est *demandé*,
  il n'est pas *fautif* : la teinte de danger est celle de l'erreur de saisie (§5.7) et du refus
  d'écriture (§5.7 ter), et l'employer ici dirait que la valeur est mauvaise là où elle est
  seulement absente. Un liseré **gauche de 3 px** `--color-brand` sur une surface `--color-surface`,
  `--radius-sm`, rembourrage 12 px. C'est le liseré de la carte de board (§5.1) tourné d'un quart de
  tour, et aucun jeton n'est ajouté.

- **Le liseré n'informe pas, il accompagne.** L'information est portée par une **mention en toutes
  lettres**, 13 px `--color-brand`, précédée de l'icône Lucide `ArrowRightLeft` en `aria-hidden` —
  la même que la famille « Étapes » du fil (§5.11), puisque c'est le même geste qui est en cause.
  Le §1 s'applique sans exception : une couleur ne porte jamais seule une information.

- **La mention du §5.7 n'est pas remplacée, elle s'ajoute.** Un champ peut être obligatoire à l'étape
  courante *et* exigé par le déplacement demandé ; les deux phrases sont vraies et disent deux choses
  différentes. C'est la règle du §5.7 ter sur la coexistence de l'alerte de manque et de l'alerte de
  refus, appliquée aux mentions.

- **Le premier champ exigé prend le focus à l'arrivée**, et son bloc est amené au centre. Faire
  défiler sans déplacer le focus laisserait l'utilisateur au clavier en tête de page : le §8 ne
  connaît pas d'exception à la parité souris / clavier. Le geste ne se produit **qu'une fois par
  adresse** — un défilement qui reprendrait la main pendant la saisie serait un vol de focus — et
  respecte `prefers-reduced-motion` (§6).

- **Aucune bannière en tête de formulaire.** Le §5.13 et le §5.16 ont déjà tranché deux fois que le
  message se lit près de ce qu'il concerne ; une liste récapitulative en tête dirait une seconde fois
  ce que chaque champ dit déjà, et éloignerait l'information du contrôle à remplir.

- **La commande qui mène ici est un LIEN, pas un bouton**, et elle vit dans le bandeau de refus du
  board (`docs/SPEC-workflow-engine.md` §7.10). Elle change d'adresse : en faire un bouton lui
  retirerait le clic du milieu, le nouvel onglet et la copie de l'adresse, que le §12.1 a déjà
  retenus comme le motif de préférer un lien à un contrôle.

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

- **Aucune resynchronisation.** Pas de « remettre à jour depuis la source », pas même grisé : la
  copie est une divergence assumée, et ce geste-là n'existe nulle part dans le produit
  (`docs/SPEC-workflow-engine.md` §4.1, qui l'interdit explicitement). C'est la règle du §5.15 sur
  les exigences héritées, appliquée à un bloc entier — un bouton grisé enseignerait un geste qui
  n'existe pas.

  **RÈGLE RÉVISÉE le 2026-08-16, et le motif est écrit.** Cette puce interdisait aussi « comparer »,
  et elle avait raison de le faire : au moment où elle a été posée, aucune fonction ne savait
  comparer une copie à sa source vivante, exactement comme la mention elle-même était impossible
  tant que la webapp était un appelant anonyme (INC-021). **Le motif a disparu** :
  `compare_workflow_with_source` est livrée et prouvée depuis le §4 ter, et le §4 ter.7 nomme le
  geste d'interface comme le seul reste. L'interdiction portait sur un geste inexistant, pas sur un
  principe ; elle tombe avec l'inexistence. Ce qui demeure est la partie qui n'a jamais dépendu de
  la fonction : **aucune écriture**.

- **La commande « comparer » vit DANS la mention, et n'ouvre pas de bloc à elle**
  (`docs/SPEC-workflow-engine.md` §4 quater.2). La comparaison porte sur le workflow entier, comme
  la mention ; lui donner un bloc propre dans la colonne de droite la ferait concurrencer le bloc
  des versions, qui parle d'autre chose — de versions publiées, que ni la copie ni sa source n'ont
  forcément.

- **Elle est rendue même lorsque la source n'a pas changé**, et ce n'est pas une symétrie gratuite :
  le signal de divergence dit que la **source** a bougé, jamais que la copie s'en écarte. Une copie
  modifiée dont la source est intacte diverge pourtant, et n'offrir la comparaison que sur le signal
  cacherait précisément ce cas.

- **Elle n'est PAS réservée à l'administrateur**, à la différence de tous les autres gestes de cet
  éditeur : comparer est une lecture, et un `viewer` obtient le même document (§4 ter.8, ligne b).
  La masquer poserait dans l'interface une règle que la base ne pose pas — ce que `CLAUDE.md` §10
  refuse dans les deux sens, pas seulement dans celui du laxisme.

- **Le résultat s'efface dès qu'il devient faux** : au changement de workflow, et à tout geste de
  l'éditeur qui réécrit la structure. Un document de comparaison décrit un instant ; le laisser à
  l'écran après une modification en ferait une affirmation périmée que rien ne signale — même règle
  que le plan de remappage du §7 ter.14.5.

- **Le résultat repose sur sa propre surface `--color-bg`, à l'intérieur de la mention**, et cette
  règle vient de l'OBSERVATION des captures (`CLAUDE.md` §16), pas d'une intention. La mention porte
  `--color-hover` lorsque la source n'a pas changé ; or la pilule « Modifié » porte ce **même**
  jeton. Rendue à même la mention, elle perdait sa forme et se confondait avec le fond, là où
  « Ajouté » et « Retiré » gardaient la leur. Le mot restait lisible — le §1 était tenu —, mais les
  trois genres cessaient d'être distingués pareillement. C'est la limite d'une pilule neutre : elle
  n'existe que par contraste avec ce qui la porte.

- **CETTE SURFACE POSE AUSSI SA COULEUR DE TEXTE, ET C'EST `--color-text` — INC-130, MESURÉE ET
  CLOSE le 2026-08-25.** Poser un fond sans poser l'encre qui va dessus laisse le document **hériter
  de la mention**, dont la teinte dit l'état de la SOURCE et non le contenu de la comparaison. Le
  code le savait et l'écrivait `text-text-1` — un niveau que l'échelle des neutres du §1 ne porte
  pas : elle nomme `--color-text`, `--color-text-2` et `--color-text-3`, sans `-1`. La classe
  n'était donc **pas engendrée du tout** (§11), et le document rendait deux couleurs différentes
  selon un état qu'il ne décrit pas. **Les deux sont relevées sur la pile réelle avec le jeton de
  l'administratrice**, `getComputedStyle` sur le document lui-même :

  | Mention qui le porte | Encre réellement rendue | Jeton hérité | Contraste sur `--color-bg` |
  |---|---|---|---|
  | `data-divergente="oui"` | `#736e2c` | `--color-accent-on-soft` | 4,95:1 |
  | `data-divergente="non"` | `#4b5563` | `--color-text-2` | 7,11:1 |

  **Ce n'est PAS un défaut de contraste**, et le dire autrement serait plus grave que le défaut :
  les deux valeurs tiennent l'AA du §8. C'est un défaut de **sens** — le document de comparaison se
  teinte d'accent, c'est-à-dire de la couleur que ce document réserve à l'avertissement, alors qu'il
  ne fait que rapporter ce qui diffère.

  **`--color-text` et non `--color-text-2`**, et le choix se tranche par la mesure plutôt que par le
  goût : les deux valeurs héritées sont celles de la mention, si bien que retenir `--color-text-2`
  reviendrait à figer l'un des deux héritages et à laisser le document se confondre avec le cadre
  qui l'annonce. Ce document est le **contenu** de l'écran, pas une note de son cadre : il prend
  l'encre du corps du §2 (`#374151`, 9,70:1). La règle vaut pour **toute** surface qui pose son
  propre fond à l'intérieur d'un bloc teinté : poser le fond sans l'encre est un demi-geste, et
  l'héritage rend alors la teinte du cadre.

- **L'en-tête non comparé est ÉCRIT, pas tu.** Les cinq collections rendues n'incluent pas le nom,
  la portée ni le track — la copie ne les copie pas (§4 ter.3). Afficher un intitulé « Workflow »
  toujours vide enseignerait qu'on a regardé et que c'est identique ; l'écran écrit donc une ligne
  qui dit ce qui n'a pas été regardé. C'est le §12.5 sous une autre forme : on ne laisse pas croire
  à une mesure qu'on n'a pas faite.

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

### 5.19 Carnet de contacts — `CRM-060`

Première surface **de travail** transverse du produit — ni un board, ni une administration. Ce que
l'écran lit, et ce qu'il ne fait pas, est spécifié par `docs/SPEC-contacts.md` §10 ; les règles
ci-dessous ne disent que de quoi il a l'air.

- **Un tableau du §5.9, et non la liste imbriquée du §5.13.** Les cinq colonnes — nom,
  organisation, fonction, email, téléphone — sont les **mêmes** pour chaque ligne, et il n'y a rien
  à imbriquer : un contact n'a pas d'enfant. C'est exactement la distinction que le §5.16 a déjà
  tranchée pour la corbeille. Les hauteurs de ligne, les séparateurs, l'ellipse et l'en-tête
  collant du §5.9 sont conservés sans changement.

- **Une donnée absente laisse la cellule VIDE** (§5.9) : ni tiret, ni « — », ni « non renseigné ».
  La règle est ici **visible à la capture** et non seulement écrite, le seed exerçant les trois cas
  — un contact sans organisation ni fonction, un contact sans email, un contact sans téléphone.
  L'écart avec « Jamais relevée » du §5.14 et « Auteur inconnu » du §5.16 tient au même critère que
  ces deux entrées posent : là, l'absence est un **fait** de la ligne ; ici, c'est une donnée qui
  n'existe simplement pas pour ce contact.

- **L'email et le téléphone sont des données techniques** (§2) : monospace, chiffres tabulaires,
  alignés à droite comme au §5.9 — ils se comparent colonne par colonne, ce qui est la seule raison
  d'avoir des chiffres tabulaires.

- **Le nom de l'organisation est un LIEN vers sa fiche** (§5.20), et **aucun autre lien n'existe**.
  Aucun `mailto:` ni `tel:` — écrire à un contact depuis le carnet est un geste que personne n'a
  spécifié, et un lien qui ouvre le client du système sortirait du produit sans le dire. Une
  cellule **sans** organisation reste **vide et sans lien** : un lien n'apparaît que là où il a une
  destination.

  > **RÉVISION DU 2026-08-18** (`docs/SPEC-contacts.md` §11.6). Cette entrée posait auparavant
  > « aucun lien, ni vers une fiche, ni vers un client de messagerie », le nom d'organisation
  > restant un texte parce que sa fiche n'existait pas et qu'un lien sans destination serait mort
  > (§5.10). **La fiche est livrée** par la sous-tranche 4b : la condition est tombée, et la règle
  > change par **livraison**. Le reste de l'entrée est inchangé.

- **L'état vide n'offre AUCUNE action**, et c'est l'écart au §5.8 que le §5.16 a déjà pris pour la
  corbeille : cette surface ne livre aucun geste de création, et un bouton y serait un chemin vers
  nulle part. Les trois autres états du §5.8 sont traités — squelettes à la forme du tableau,
  erreur avec reprise qui relit réellement, et l'absence d'espace de travail.

- **Aucune pagination, aucun tri commandé, aucun filtre**, contrairement au tableau du §5.9. Ce
  n'est pas un oubli : l'ordre vient du serveur, et poser une pagination sur une lecture dont
  personne n'a mesuré le volume serait de l'optimisation sans mesure (`CLAUDE.md` §21). L'écart est
  nommé dans `docs/SPEC-contacts.md` §10.7, avec la condition de sa reprise.

- **Le conteneur du tableau porte `.indique-debordement-x`** (§12.6), comme la vue liste : à
  390 px les cinq colonnes ne tiennent pas, et le tableau défile **dans son conteneur** pendant que
  la page ne défile jamais horizontalement (§7). Aucun `scroll-snap`, faute de colonne sur laquelle
  s'ancrer — la règle du §5.9.

### 5.20 Fiche d'organisation — `CRM-060`

Surface de **détail** atteinte depuis le carnet (§5.19), jamais depuis la barre latérale : il
n'existe aucune liste d'organisations. Ce que l'écran lit est spécifié par `docs/SPEC-contacts.md`
§11 ; les règles ci-dessous ne disent que de quoi il a l'air.

- **Deux zones, et deux structures différentes.** Ce qui caractérise l'organisation — domaine, site
  web — est une **liste de définitions** (`<dl>`), des couples libellé/valeur qui ne se comparent
  pas entre eux. Ses contacts sont des lignes homogènes et reprennent le **tableau du §5.9**, à
  **quatre** colonnes : nom, fonction, email, téléphone. La colonne « organisation » du carnet
  disparaît — elle répéterait le titre de la page à chaque ligne.

  La liste de définitions passe à **deux colonnes à partir de `md`** (768 px), et reste empilée
  en dessous. **`md` et non `sm`, et ce n'est pas un choix esthétique** : le §7 ne définit que
  trois paliers, et `tokens.css` réinitialise explicitement les autres
  (`--breakpoint-*: initial`). Un `sm:` est donc un **variant inconnu**, dont Tailwind supprime
  la classe entière sans rien signaler — le défaut exact que le §11 décrit, et qui a été
  **mesuré** ici : `sm:grid-cols-2` était absente du CSS produit, et la fiche restait empilée à
  1440 px. Toute règle responsive de ce document s'écrit avec `md`, `lg` ou `xl`, jamais `sm`.

- **Le nom de l'organisation est le titre de la route** : une **donnée**, portée par `titreRoute`
  de la coquille et non par une clé de traduction (§10), avec une clé de repli pendant le
  chargement — le patron du détail de card (§5.3).

- **`domain` et `website` sont des données techniques** (§2) : monospace. Une valeur absente laisse
  la valeur **vide** — ni tiret, ni « non renseigné » —, la règle du §5.9 que le §5.19 tient déjà.

- **`website` est un lien, `domain` ne l'est pas.** Un site web a une destination réelle, et la
  contrainte de base garantit sa forme `http`/`https` : il s'ouvre dans un **nouvel onglet**, avec
  `rel="noreferrer noopener"`, et sa sortie du produit est **annoncée** — un lien externe se
  signale (§8). Un domaine n'est pas une URL mais un pivot de rapprochement d'emails : en faire un
  lien inventerait un schéma que la donnée ne porte pas.

- **Cinq états, tous traités** (§5.8). Squelettes pendant la lecture ; erreur avec reprise qui
  relit réellement ; **organisation introuvable**, qui porte un retour vers le carnet et qui est le
  **même** écran pour un identifiant inconnu, pour un appelant sans droit et pour une adresse mal
  formée (`docs/SPEC-permissions-rls.md` §7) ; **zone des contacts vide** — sans action, comme le
  §5.19 et le §5.16, cette surface ne livrant aucun geste de création.

- **Le nom d'un contact EST un lien vers sa fiche** — RÉVISÉ le 2026-08-19 par la livraison de la
  fiche de contact (§5.24). La règle posée ici était : « il n'existe pas de fiche de contact, et un
  lien y serait mort » — la règle exacte que le §5.19 venait d'abandonner pour l'organisation,
  tenue ici pour la raison qui la fondait là. Cette condition tombe par LIVRAISON, jamais par
  contournement.

- **Le conteneur du tableau porte `.indique-debordement-x`** (§12.6), comme le §5.19 : à 390 px les
  quatre colonnes ne tiennent pas, et le tableau défile **dans son conteneur** pendant que la page
  ne défile jamais horizontalement (§7).

### 5.21 Contacts d'une affaire — `CRM-060`

Bloc de la **colonne gauche** du détail de card (§5.3), et **première écriture** que le carnet de
contacts exerce. Ce que le bloc lit, envoie et refuse est spécifié par `docs/SPEC-contacts.md` §12 ;
les règles ci-dessous ne disent que de quoi il a l'air. Tout ce que le §5.13 pose vaut ici sans être
répété : formulaire et confirmation **dans le flux du document — aucune modale**, focus entrant dans
le premier champ et rendu à la commande qui l'a ouvert, alerte de refus **dans le bloc concerné**.

- **Il vit ENTRE le formulaire et le bloc de corbeille**, et l'ordre de la colonne gauche devient :
  en-tête, formulaire, contacts, corbeille. Les deux bornes sont déjà écrites au §5.3 — la colonne
  droite « raconte » et n'accueille aucun geste, et le retrait reste en bas « parce qu'un retrait
  n'est pas ce qu'on vient faire sur une fiche ». Les contacts d'une affaire appartiennent à son
  dossier, donc ils se lisent avec lui.

- **Une `ul` de lignes, ni le tableau du §5.9 ni l'arborescence du §5.13.** C'est le patron de la
  liste plate du §5.18, et pour ses deux motifs exactement : la colonne fait `72ch` au plus, et
  chaque ligne porte **sa propre commande**. Les hauteurs de ligne et les séparateurs du §5.9 sont
  conservés — `--size-target`, bordure basse `--color-border`, survol `--color-hover`, aucune
  zébrure.

- **Le rôle dans l'affaire est un MOT, jamais une teinte** (§1), et il n'est **pas traduit** : c'est
  une valeur métier libre que la base n'énumère pas (`docs/SPEC-contacts.md` §2.3), au même titre
  qu'un libellé de track (§10). Il se rend en pilule neutre `--color-hover` / `--color-text-2`,
  `rounded-full` (§5.6). Un rattachement **sans rôle** ne rend **rien** à cette place : ni tiret, ni
  « non renseigné » — la règle du §5.9 que les §5.19 et §5.20 tiennent déjà.

- **Le nom de l'organisation est un lien vers sa fiche** (§5.20), comme au §5.19 : la destination
  existe. **Le nom du contact n'en est pas un** — il n'existe pas de fiche de contact, et un lien y
  serait mort (§5.10, §5.20).

- **Le sélecteur n'offre que les contacts NON ENCORE rattachés.** Ce n'est pas une garde de droit,
  c'est le refus d'une commande vouée à l'échec : rattacher deux fois le même contact rend `409`
  (mesuré), et c'est la règle que le §5.15 a posée pour la case « par défaut » d'un workflow. Le
  refus reste néanmoins traduit : deux utilisateurs peuvent agir à la même seconde.

- **Trois vides distincts, et aucun ne se confond avec un autre** (§5.8) : « aucun contact rattaché
  à cette affaire », qui **garde son formulaire** — c'est le geste qui le comble, la règle du §5.13
  pour l'état vide d'une surface qui agit ; « tous les contacts sont déjà rattachés », qui n'affiche
  **aucun sélecteur vide** ; et « cet espace de travail n'a aucun contact », qui n'offre **aucune
  action** — aucun écran du produit ne crée de contact, et un bouton y serait un chemin vers nulle
  part (§5.16, §5.19).

- **Le détachement demande une confirmation NOMMANT le contact** (§6). C'est un retrait : la ligne
  disparaît et le rôle saisi avec elle, sans reprise possible. Elle se distingue en cela de
  « Restaurer » du §5.16, qui répare, et son bouton d'action est **destructif** (§5.5) comme celui
  du §5.3 — la teinte de danger annonce le geste qu'on est sur le point de commettre. La commande
  qui l'ouvre reste **secondaire discrète**, icône `Unlink`, jamais `Trash2` : un contact détaché
  n'est ni supprimé ni mis à la corbeille, et l'icône de la corbeille dirait le contraire.

- **« Sans effet » est dit en toutes lettres, et n'est ni un succès ni une erreur** — la règle du
  §5.3 et du §5.3 ter, reprise sans changement. MESURÉ : la lectrice qui détache reçoit `200` et
  **zéro ligne**, indistinguable d'une ligne déjà retirée par un tiers. L'écran écrit « aucun
  rattachement n'a été retiré » et **relit** la liste. Annoncer un retrait qui n'a pas eu lieu
  serait la simulation de succès que `CLAUDE.md` §18 interdit.

- **Aucune commande n'est éteinte d'avance, quel que soit le rôle** — §5.3, §5.13, §5.16, sans
  exception. La règle vit dans `card_contacts_insertion` et `card_contacts_suppression` ; une
  commande grisée ferait passer une décision de la base pour une décision d'écran.

- **Un refus n'efface pas la saisie** (§5.7 ter) : le contact choisi et le rôle tapé restent à
  l'écran avec leur explication.

- **La liste est RELUE après chaque écriture, jamais complétée localement** — la règle du §5.15 pour
  la création d'un workflow. Une insertion optimiste contredirait l'ordre du serveur le temps d'un
  rendu, et masquerait un rattachement posé entre-temps par un collègue.

- **Le message d'un geste vit dans le BLOC, sous la liste, et non dans la ligne visée.** C'est un
  défaut trouvé **par la preuve E2E**, qui est devenue intermittente : une relecture repasse le bloc
  par l'état de chargement, ce qui **démonte** la ligne, et un message qu'elle portait disparaissait
  avec elle — alors que « sans effet » exige les deux, dire ET relire. Il reste **près de ce qui l'a
  causé** au sens du §5.13 : la ligne visée peut légitimement avoir disparu, c'est même l'une des
  deux causes du « sans effet ». Le corriger par une temporisation aurait été le contournement que
  `CLAUDE.md` §18 interdit.

- **Sous le palier `md`, la ligne se REPLIE et sa commande passe à la ligne suivante.** Observé sur
  `docs/captures/CRM-060/contacts-affaire-sm-390.jpg` : à 390 px, le nom, l'organisation, le rôle et
  « Détacher » ne tiennent pas sur une seule ligne. La ligne gagne alors de la hauteur plutôt que de
  tronquer une donnée ou de rétrécir une cible sous les 40 px du §8 — c'est l'écart assumé avec la
  hauteur fixe du §5.9, et la contrepartie de n'être pas un tableau. La page ne défile jamais
  horizontalement (§7), et c'est mesuré aux quatre paliers.

### 5.22 Sélecteur de contact et sélecteur de membre — `CRM-060`

Les deux contrôles que les types `contact` et `user` du formulaire d'une affaire (§5.7, §5.7 ter)
rendent depuis la sous-tranche 4d. Ce qu'ils lisent, écrivent et refusent est spécifié par
`docs/SPEC-contacts.md` §13 ; les règles ci-dessous ne disent que de quoi ils ont l'air. Tout ce que
le §5.7 ter pose vaut ici sans être répété : mention d'état sous le champ, trois mentions jamais
deux à la fois, un refus n'efface pas la saisie.

- **C'est un `select` du §5.7, et rien d'autre.** Ni combobox, ni liste avec recherche : le nombre
  de contacts et de membres d'un workspace n'est pas mesuré (§5.19 tient déjà ce raisonnement pour
  la pagination), et un `select` natif porte la recherche au clavier de la plateforme, le rendu du
  système sur mobile et le focus visible du §8 sans une ligne de code.

- **Une option vide en tête, comme tout `select` du formulaire.** Elle est le moyen de **vider** le
  champ, exactement comme pour un `select` à choix (`docs/SPEC-form-composer.md` §4 bis.5) ; sans
  elle, un champ non renseigné afficherait le premier nom de la liste comme s'il avait été choisi.

- **Le libellé d'une option est une DONNÉE, jamais une traduction** (§10) : le nom du contact, suivi
  de son organisation quand il en a une — `« Léo Marchand — Sogexia »`. C'est la composition que le
  §5.21 a déjà retenue pour distinguer deux homonymes, et **c'est la même fonction** qui la produit
  dans les deux surfaces.

- **Une valeur qui ne désigne plus personne garde son option**, retenue, portant l'identifiant brut
  et la mention « référence inconnue ». Elle est la seule option du produit dont le libellé est un
  identifiant, et c'est assumé : la faire disparaître afficherait la **première** option comme si
  elle avait été choisie, remplaçant à l'écran une donnée enregistrée par une autre — la « valeur
  par défaut trompeuse » que `CLAUDE.md` §18 interdit. Le cas existe réellement : supprimer un
  contact ne supprime pas les valeurs qui le désignaient (`docs/SPEC-contacts.md` §9.4, mesuré).

- **Pendant la lecture de sa liste, et après son échec, le contrôle est DÉSACTIVÉ** — unique
  dérogation à la règle du §5.7 ter, et elle est bornée. Cette règle vise l'**envoi**, où les choix
  existent et où désactiver ferait perdre le focus au clavier. Ici il n'y a rien à choisir : la
  liste n'est pas là, personne n'y a encore le focus, et un `select` vide mais actif serait la
  commande morte que le §5.21 refuse. Le chargement porte une unique option « Chargement… » et
  `aria-busy` ; l'erreur porte sa mention et son **action de reprise** (§5.8), qui relit la liste.

- **Une liste vide le dit en toutes lettres, sans action** : « cet espace de travail n'a aucun
  contact ». C'est le troisième vide du §5.21, repris sans changement — aucun écran du produit ne
  crée de contact, et un bouton y serait un chemin vers nulle part (§5.16, §5.19).

- **En lecture seule, dans la section repliée du formulaire, la valeur se rend en NOM.** Si elle ne
  se résout pas, ou si la liste n'a pas pu être lue, c'est l'**identifiant brut** qui s'affiche, en
  **donnée technique** au sens du §2 — monospace, chiffres tabulaires, comme les montants et les
  dates du §5.7 bis. Un identifiant est une donnée technique ; le rendre en texte ordinaire le
  ferait passer pour un nom.

- **Aucune couleur, aucun jeton, aucune icône nouvelle.** Ces deux contrôles empruntent entièrement
  au §5.7 et au §5.7 ter.
### 5.29 Canevas d'objectifs — `CRM-083`

Spécifié avant code, `docs/SPEC-goals.md` §5.

**Bloc.** Carte `--color-surface`, rayon standard, ombre légère, **liseré gauche de 4 px** portant
la couleur de jeton du bloc. Titre en 15 px `--color-ink`, extrait du corps en 13 px
`--color-text-2` sur deux lignes maximum. En pied, la jauge de remplissage et, si le bloc est lié,
la **pilule de channel** au format « Track › Channel », qui réemploie la pilule de track du §5.5 bis.

**Jauge de remplissage.** Barre de 6 px, fond `--color-brand-soft`, remplissage `--color-brand`, la
valeur en clair à droite. **Elle ne change jamais de couleur avec la valeur** : un remplissage saisi
à la main n'est ni bon ni mauvais, et le vert ou le rouge y introduiraient un jugement que le
produit n'a pas à porter. C'est l'écart le plus tentant de ce composant, et il est interdit.

**Flèche.** Trait de 2 px `--color-text-3`, pointe pleine à chaque extrémité concernée par la
direction. Libellé centré en 12 px sur un fond `--color-surface` qui interrompt le trait. Une flèche
dont la cible n'est pas rendue — bloc masqué par la RLS — est **pointillée et sans libellé** ;
l'écran ne nomme jamais ce qu'il cache.

**Focus et clavier.** L'anneau de focus `--color-brand` porte sur le bloc entier. Le canevas est
entièrement pilotable au clavier (§8 et `docs/SPEC-goals.md` §5.5), et une **liste textuelle
équivalente** du diagramme — « A → B », « B ↔ C » — accompagne le canevas pour les lecteurs
d'écran. Un diagramme qui n'existe que visuellement n'est pas accessible.

**Commandes de zoom.** Deux boutons à la taille de cible, encadrant la valeur en clair
(`100 %`). Au dernier palier, le bouton est **indisponible et lisible** (§8) plutôt qu'inopérant :
un bouton qui ne fait rien sans le dire est un défaut, pas une borne.

**LES ESPACES DE NOMS DE TAILWIND SONT REMIS À ZÉRO (§11), ET CE COMPOSANT L'A APPRIS EN
S'AFFICHANT.** La jauge de 6 px avait d'abord été écrite `h-1.5`, la pilule `py-0.5` : **ni l'une
ni l'autre de ces classes n'existe** — l'échelle ne porte que `0, 1, 2, 3, 4, 6, 8, 12` —, si bien
que la barre était **invisible** sur la capture alors que la valeur en clair s'affichait
correctement. C'est la faute exacte que consigne INC-158. Une mesure hors de l'échelle s'écrit en
valeur arbitraire assumée (`h-[6px]`), jamais en fraction de l'échelle.

**Les gestes de géométrie — tranche 2a, `docs/SPEC-goals.md` §3 et §5.5.** Ils n'ajoutent aucun bloc
à l'écran : ils s'insèrent dans le canevas déjà décrit ci-dessus. Ce qu'ils envoient et refusent est
spécifié là-bas ; les règles ci-dessous ne disent que de quoi ils ont l'air.

- **La commande de pose a DEUX VISAGES, un seul rendu à la fois** — « Poser un bloc » en primaire
  compacte, « Annuler la pose » en secondaire compacte, avec `aria-pressed` —, patron du §5.3
  quater. Elle vit dans l'en-tête du canevas, à côté des commandes de zoom, parce qu'elle porte sur
  le canevas entier et non sur un bloc.

- **Le repère de pose est un rectangle à la taille d'un bloc neuf**, liseré 2 px `--color-brand` sur
  `--color-brand-soft`, et **son nom accessible écrit sa position**. Sans ce nom, un utilisateur au
  lecteur d'écran déplacerait un repère sans savoir où il est ; la position n'est portée par rien
  d'autre, le repère n'ayant aucun contenu. Le focus **entre** dans le repère dès qu'il paraît
  (§5.13) : un repère que les flèches ne pilotent qu'après un `Tab` supplémentaire n'est pas le
  geste clavier que le §5.5 de la spécification demande.

- **L'état vide du tableau porte la commande de pose**, et le canevas est rendu dès qu'une pose est
  armée — la règle du §5.13 pour l'état vide d'une surface qui agit. Un état vide qui remplacerait
  la surface n'aurait aucun endroit où recevoir le clic.

- **La consigne clavier est visuellement masquée, jamais retirée** (§12.3), et **citée par chaque
  bloc** en `aria-describedby`. Un geste qui n'existe qu'au clavier doit être annoncé au clavier,
  sans quoi il n'existe pour personne.

- **La poignée de redimensionnement est une affordance de SOURIS**, `aria-hidden` et hors du
  parcours de tabulation : le clavier dispose du geste complet (`Alt` + flèches), et un bouton qui
  ne ferait rien sur `Entrée` serait la commande morte que le §5.10 proscrit.

  **ÉCART ASSUMÉ AU §8, ET IL EST BORNÉ.** Sa zone sensible mesure **24 px** et non les 40 px de la
  cible minimale. Le motif est la géométrie du composant : un bloc peut descendre à 120 × 72 px, et
  une poignée de 40 px y couvrirait son pied — donc sa jauge et sa pilule de channel. L'écart ne
  prive d'aucun geste, puisque le chemin clavier est **complet et équivalent** ; c'est la condition
  à laquelle il est pris, et il tombe si ce chemin disparaît.

  **Sa MARQUE est plus petite que sa zone sensible — 12 px pour 24 —, et c'est un défaut trouvé en
  regardant une capture** (`CLAUDE.md` §16). Dessinée d'abord à même les 24 px et suivant le rayon
  de la carte, l'équerre se lisait comme une **languette accrochée au coin** de chaque bloc. La
  règle vaut au-delà de ce composant : une affordance d'angle se dessine à l'intérieur de sa zone
  sensible, elle n'en épouse pas le contour.

- **Un déplacement refusé replace le bloc à sa position d'origine** — la règle du §6 pour le
  glisser-déposer d'une card, tenue sans changement. Le geste est **optimiste** à l'écran ; la
  réponse du serveur, succès, refus ou silence, l'efface toujours.

- **Les trois mentions du §5.7 ter vivent SOUS le canevas**, jamais en tête d'écran, et la région
  est **toujours rendue** — un refus porte `role="alert"`, une attente et une confirmation
  `role="status"`. Un geste de géométrie porte sur le canevas entier, et non sur une ligne : c'est
  là qu'il se lit.

**La fiche d'édition d'un bloc — tranche 2b-1, `docs/SPEC-goals.md` §3 et §5.5.** Elle non plus
n'ajoute aucun bloc à l'écran : elle s'ouvre SOUS le canevas, dans le flux, et le canevas reste
entier au-dessus d'elle.

- **Elle n'est PAS une fenêtre en surimpression, et ce n'est pas un choix d'implémentation.** Le
  bloc qu'elle édite doit rester visible pendant la saisie : c'est lui qui montre l'effet de la
  couleur et du remplissage qu'on est en train de régler. Une fenêtre posée par-dessus le canevas
  le cacherait une fois sur deux, selon l'endroit où le bloc se trouve — et l'utilisateur réglerait
  une valeur sans voir ce qu'elle fait.

- **Elle n'a AUCUN bouton d'enregistrement** : chaque champ écrit sa propre valeur dès qu'elle est
  arrêtée, et les six règles du §5.7 ter s'appliquent sans exception — mention sous le champ, trois
  mentions jamais deux à la fois, contrôle jamais désactivé pendant l'envoi, refus qui n'efface pas
  la saisie. Un bouton unique renverrait les quatre colonnes à chaque fois et écraserait ce qu'un
  collègue vient d'écrire dans un autre champ du même bloc : c'est exactement le défaut que la
  tranche 2a a corrigé sur la géométrie, et il se reposerait ici sous une autre forme.

- **Quand la valeur est « arrêtée », selon le contrôle.** Un champ de texte : à la sortie du champ,
  ou sur `Entrée`. Le curseur : au **relâchement**, jamais à chaque pas — un glissement émettrait
  une requête par pour cent parcouru, comme une touche maintenue en émettrait une par pixel (§5.29,
  gestes de géométrie). Un groupe de boutons radio : au choix, qui est déjà un geste arrêté.

- **Le curseur et le champ numérique du remplissage sont UN SEUL contrôle à deux entrées.** Ils
  partagent un état et une fonction d'écriture ; deux chemins distincts divergeraient au premier
  ajustement, et l'un des deux finirait par écrire autre chose que ce qu'il montre. Le curseur porte
  `--color-brand` en `accent-color`, le champ numérique la largeur `10ch` et les chiffres tabulaires
  du §5.9.

- **La couleur est un groupe de boutons radio, jamais une liste déroulante**, et **chaque option
  porte son nom en clair** à côté de sa pastille. Cinq choix visuels se comparent en un regard, là
  où un `select` en cacherait quatre ; et le §1 vaut ici comme partout — une pastille seule ferait
  porter l'information par la couleur.

- **Le bloc dont la fiche est ouverte est désigné** par un liseré `--color-brand` et un anneau
  `--color-brand-soft`, qui **s'ajoutent** à l'anneau de focus sans le remplacer : ce sont deux
  informations différentes — « ce bloc a le focus » et « ce bloc est celui que la fiche édite ».
  Sans cette marque, une fiche posée sous un canevas de douze blocs n'aurait aucun lien lisible avec
  le sien.

- **Le focus entre dans la fiche à l'ouverture et revient au bloc à la fermeture** (§5.13). Une
  fiche ouverte par `Entrée` qu'il faudrait ensuite atteindre en traversant tout le canevas ne
  serait pas le geste clavier que `docs/SPEC-goals.md` §5.5 demande ; et une fermeture qui renverrait
  le focus au début du document ferait perdre sa place au clavier. `Échap` ferme depuis n'importe
  lequel des champs.

- **Le clic sur un bloc ouvre sa fiche ; le glissement le déplace.** C'est le binôme souris de la
  touche `Entrée`, et la distinction se fait sur le **déplacement réel**, sans tolérance en pixels :
  les deux géométries comparées sont déjà des entiers. Une tolérance rendrait un petit glissement
  volontaire indistinguable d'un clic et ouvrirait une fiche à la place d'un déplacement.

**Le champ « Channel visé » de la fiche**, livré par la tranche 2b-2a. C'est un `select` alimenté
par une liste distante : **le §5.22 s'applique intégralement**, et n'est pas répété ici. Ce qui lui
est propre :

- **Les options sont groupées par track dans des `optgroup`**, comme `docs/SPEC-goals.md` §3 le
  demande. C'est le seul moyen natif de grouper des options sans réécrire un sélecteur au clavier,
  et l'intitulé du groupe est une **donnée** — le nom du track —, jamais une traduction (§10).

- **L'ordre est celui que le serveur rend**, jamais retrié à l'écran. La requête ordonne déjà par
  `position` puis par nom ; rejouer ce tri ici le ferait diverger le jour où la requête changera.

- **Un channel dont le track n'est pas rendu est listé hors de tout groupe, en dernier.** Il n'est
  pas écarté : l'appelant le lit, il a donc le droit de le viser, et le faire disparaître parce que
  son parent n'est pas lisible lui retirerait une destination légitime sans jamais le dire. Aucun
  intitulé de groupe n'est inventé pour lui.

- **La destination actuelle reste une option même absente de la liste** — même raison qu'au §5.22 :
  un channel archivé, ou dont la lecture vient de se fermer, n'est pas liable ; sans son option, le
  sélecteur retomberait sur « Aucun channel » et afficherait un **retrait de lien qui n'a pas eu
  lieu**, que le premier geste sur un autre champ rendrait vrai.

- **Le retrait a deux entrées, et le bouton n'existe que s'il y a un lien.** L'option vide retire au
  clavier ; un bouton « Retirer le lien » double le geste à la souris. Rendu en permanence, il
  n'aurait rien à défaire la moitié du temps — la commande morte que le §5.21 refuse. Il reste
  offert quand la LISTE est en erreur : retirer ne demande aucune liste.

- **Le refus de la destination porte son propre texte.** « Vous ne pouvez pas modifier ce tableau »
  serait faux lorsque c'est le droit d'écrire dans le channel visé qui manque
  (`docs/SPEC-goals.md` §4.2), et ferait chercher le problème du mauvais côté. Le **retrait**, lui,
  garde le texte commun : il n'engage aucune destination.

**Les suppressions — tranche 2b-2c, `docs/SPEC-goals.md` §3.** Elles n'ajoutent aucun bloc à
l'écran non plus : la commande d'un bloc s'ajoute au pied de sa fiche, celle d'une flèche à sa ligne
de la liste des liens. Ce que les gestes envoient et refusent est spécifié là-bas ; les règles
ci-dessous ne disent que de quoi ils ont l'air. Tout ce que le §5.27 pose vaut ici sans être
répété : une seule confirmation à tout instant, la commande qui reste montée et désactivée, la
confirmation dans le flux du document — **aucune modale**.

- **La commande de suppression d'un bloc est EN BAS de sa fiche, dans un bloc séparé par une
  bordure haute `--color-border`** — la place exacte que le §5.3 donne au retrait d'une affaire, et
  pour son motif : un retrait n'est pas ce qu'on vient faire sur une fiche d'édition. Elle est
  **secondaire compacte** avec l'icône `Trash2` ; c'est le **bouton de la confirmation** qui est
  destructif plein (§5.5), la teinte de danger annonçant le geste qu'on commet et non celui qu'on
  envisage.

- **La commande d'une flèche vit dans la LISTE DES LIENS, jamais sur le dessin**, à côté du
  sélecteur de direction et pour son motif exact (tranche 2b-2b) : le trait est un `<path>` dans un
  SVG `aria-hidden` sans événements de pointeur, que ni le clavier ni un lecteur d'écran
  n'atteindraient. Son **nom accessible nomme la flèche** — « Supprimer » seul, répété sur chaque
  ligne, ne dirait pas laquelle.

- **LA CONFIRMATION DU BLOC ANNONCE CE QUE LA CASCADE EMPORTE**, et c'est la règle propre à cette
  surface. Supprimer un bloc supprime ses flèches (`docs/SPEC-goals.md` §2.3) : une confirmation qui
  le tairait ferait découvrir après coup la disparition de liens que personne n'a demandé de
  retirer. **L'accord se fait par CLÉ** — aucune flèche, une flèche, plusieurs avec leur compte —,
  jamais par un gabarit paramétré : « les 1 flèches » est faux (§10). Le compte est celui des
  flèches **rendues**, jamais un total de la base : une flèche dont l'autre extrémité est masquée
  pend déjà dans le vide (§5.29, flèche), et la confirmation ne peut annoncer que ce que celui qui
  la lit verra disparaître.

- **La confirmation d'une flèche ne parle d'AUCUNE cascade** — une flèche n'emporte rien —, et elle
  nomme ses deux extrémités avec son symbole. Deux textes distincts pour deux pertes distinctes,
  comme le §5.27 l'exige d'une confirmation qui nomme son objet.

- **LE RETOUR DU FOCUS EST DIFFÉRÉ D'UN TOUR DE RENDU, ET LE MOTIF DIFFÈRE DE CELUI DU §5.25.**
  La commande reste **montée** pendant sa confirmation — le §5.27 — mais elle est **désactivée**,
  et un bouton désactivé **refuse le focus** : appelé depuis le gestionnaire d'annulation,
  `focus()` laissait le focus sur le document. Le remède est celui du §5.25 — un drapeau, puis un
  effet —, pour une cause voisine mais distincte : là-bas la commande est démontée, ici seulement
  éteinte. **Aucune temporisation** (`CLAUDE.md` §18). Défaut trouvé **par la preuve**, jamais à la
  lecture.

- **LA FLÈCHE D'UN BLOC SUPPRIMÉ DISPARAÎT, elle ne devient pas le moignon pointillé du §5.4.** Les
  deux causes n'ont rien de commun : le moignon rend une extrémité que la RLS **masque** — la ligne
  existe en base —, tandis que la cascade l'a **détruite**. La laisser pendre dessinerait un lien
  que plus rien ne porte.

- **Aucune commande n'est éteinte d'avance selon le rôle** (§5.3, §5.13, §5.16, §5.21, §5.27, sans
  exception), et **le silence de la clause `using` est dit en toutes lettres** : MESURÉ, la lectrice
  qui confirme reçoit `200` et zéro ligne. L'écran écrit « aucun bloc n'a été supprimé », **garde le
  bloc à l'écran** et invite à recharger. Le faire disparaître annoncerait une suppression qui n'a
  pas eu lieu, et il reparaîtrait au rechargement.

- **Aucune couleur, aucun jeton nouveau** : le geste emprunte au §5.5 ses variantes et au §5.3 son
  icône `Trash2`.

**L'administration des tableaux — tranche 2c, `docs/SPEC-goals.md` §2.1, §3 et §5.1.** La LISTE du
§5.1 devient administrable : créer, renommer, réordonner, archiver. Elle n'invente aucun patron,
elle applique celui du **§5.13** — la première surface d'administration du produit — et les règles
ci-dessous ne disent que ce qui lui est propre.

- **La liste est celle du §5.13, sans exception** : lignes `ul` / `li` à la hauteur de cible,
  séparateur `--color-border`, barre de boutons discrets compacts **toujours visibles**, commandes
  d'ordre **désactivées aux extrémités et jamais masquées**, formulaires et confirmation **dans le
  flux du document** — aucune modale —, focus entrant dans le premier champ et rendu à la commande
  qui a ouvert. Icônes `ArrowUp`, `ArrowDown`, `Pencil`, `Archive` (§9), et `SquarePlus` pour la
  création, déjà employée par la pose d'un bloc.

- **LE NOM ACCESSIBLE DE CHAQUE COMMANDE NOMME SON TABLEAU** — « Monter le tableau X » —, là où le
  `title` visuel reste court. Quatre commandes répétées sur chaque ligne rendraient, sous « Monter »
  seul, une liste de commandes indiscernables à un lecteur d'écran. Même règle qu'au §5.29 pour la
  suppression d'une flèche.

- **LE LIEN VERS LE TABLEAU ET SES COMMANDES SONT DISTINCTS.** La ligne n'est pas entièrement
  cliquable (§5.13) : elle porte déjà quatre commandes, et un clic ambigu ouvrirait un tableau
  quand on voulait l'archiver.

- **L'ÉTAT VIDE PORTE LA COMMANDE DE CRÉATION**, comme l'état vide d'un tableau porte la commande de
  pose (§5.29 ci-dessus). Sans elle, « Aucun tableau d'objectifs » serait un cul-de-sac dont rien
  dans le produit ne ferait sortir.

- **LA CONFIRMATION D'ARCHIVAGE DIT CE QUE LE GESTE COÛTE, ET C'EST LA RÈGLE PROPRE À CETTE
  SURFACE.** Deux conséquences ne se devinent pas et sont donc écrites : le tableau **quitte la
  liste** et aucun écran ne le rend plus — le §5.1 ne décrit qu'une liste des tableaux non archivés,
  et **le désarchivage n'est pas livré** ; et **son nom reste pris**, l'index unique de
  `goal_boards` ne l'excluant pas. Un « Archiver » nu se lirait comme un rangement réversible d'un
  clic. Le refus de doublon porte la même précision, faute de quoi on chercherait, dans une liste où
  il ne paraît plus, le tableau qui bloque.

- **LE REFUS EST LU DANS LE FORMULAIRE QUI L'A CAUSÉ** (§5.13), et **la mention d'écriture du
  formulaire porte une identité DISTINCTE de celle de la section**. Défaut trouvé **par la preuve** :
  les deux partageaient un identifiant, si bien qu'aucune preuve ne pouvait désigner l'une des deux
  et qu'un lecteur d'écran rencontrait deux régions `status` indiscernables. La mention de section
  est en outre **tue pendant qu'un formulaire est ouvert** : la même phrase lue à deux endroits
  ferait chercher deux causes.

- **UN RECHARGEMENT N'EFFACE PAS LA LISTE QU'IL RELIT.** Défaut trouvé par la preuve, corrigé à sa
  cause : chaque écriture relit la liste, et en repassant par l'état de chargement l'écran
  remplaçait celle-ci par son squelette — **démontant la commande** à laquelle le §5.13 exige de
  rendre le focus, qui retombait alors sur le document, et faisant clignoter la liste à chaque
  geste. Le squelette du §5.8 reste réservé au **premier** chargement, seul moment où il n'y a
  effectivement rien à montrer ; une **erreur**, elle, remplace bien la liste.

- **Le réordonnancement écrit UNE position, jamais une permutation** — le milieu de deux voisines,
  arithmétique du §5.13 réemployée telle quelle. Quand ce milieu n'existe pas, l'écran le **nomme**
  au lieu d'écrire une valeur qui ne changerait rien.

**Le clavier de cette liste — tranche 2 g, `docs/SPEC-goals.md` §5.5 bis.** Elle n'ajoute aucun
bloc et aucun jeton : elle complète deux règles de ce document sur la surface qui les a mises en
défaut. Les deux compléments viennent d'une **mesure** (§5.5 bis.1), pas d'une relecture.

- **LE RETOUR DU FOCUS VISE UNE ANCRE QUI SURVIT AU GESTE, et c'est un COMPLÉMENT au §5.13, jamais
  son remplacement.** Le §5.13 pose que fermer une surface rend le focus « à la commande qui l'a
  ouverte » ; il suppose que cette commande existe encore, ce qui est vrai partout ailleurs.
  **L'archivage confirmé est le seul geste du produit qui détruise la ligne portant sa propre
  commande** : MESURÉ, le focus y était rendu à un bouton que la relecture démontait aussitôt,
  `document.activeElement` retombait sur `body`, et le `Tab` suivant repartait du lien d'évitement,
  en tête de document. Le focus revient donc à la **commande de création de l'en-tête**, rendue en
  toute circonstance — y compris sur une liste devenue vide, où elle est le seul geste restant. Les
  trois autres issues sont inchangées, la ligne leur survivant. **Aucune temporisation**
  (`CLAUDE.md` §18) : le mécanisme du §5.25 — un drapeau, puis un effet — est celui de la tranche
  2 c, et seule l'ancre visée change.

- **`ÉCHAP` REFERME LES TROIS SURFACES DE LA LISTE**, depuis n'importe lequel de leurs contrôles, et
  rend le focus selon la règle ci-dessus. Le §5.13 ne l'écrivait pas parce qu'il écartait la
  **modale**, dont `Échap` est l'un des trois mécanismes ; mais une surface dans le flux **qui
  remplace sa commande** se referme par `Échap` partout ailleurs dans ce document — §5.3 quater,
  §5.3 septies —, et la fiche d'un bloc du même écran (§5.29 ci-dessus) le fait depuis la tranche
  2 b-1. MESURÉ avant correction : la touche était **sans effet** sur les trois surfaces de la
  liste, si bien que le même écran opposait deux conventions contraires à la même touche selon
  qu'on administrait la liste ou qu'on éditait un bloc.

- **Une écriture en vol n'est pas annulée par `Échap`**, et l'écran ne le prétend pas : la surface
  se ferme, l'écriture aboutit, et son issue est lue dans la mention de **section** — celle que la
  règle ci-dessus tait tant qu'une surface est ouverte. C'est la même discipline que « sans effet »
  au §5.3 ter : on ne montre jamais une issue que le serveur n'a pas rendue.

- **OUVRIR UNE SURFACE EFFACE LA MENTION DE LA PRÉCÉDENTE, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT
  UNE CAPTURE** (`CLAUDE.md` §16, 2026-08-25). La confirmation d'archivage ouverte juste après une
  création réussie affichait « Tableau créé », en vert, **sous son bouton destructif** : l'issue
  d'un geste qu'elle n'a pas causé, lue à l'endroit exact où l'on s'apprête à en commettre un
  autre. La cause n'est pas cosmétique — la mention est portée par un **état unique** de la liste,
  là où les trois surfaces la rendent chacune près de son propre champ —, et elle contredit la
  règle que le §5.13 pose depuis la première surface d'administration : le message se lit près de
  ce qui l'a **causé**. Ouvrir remet donc la mention à vide ; **fermer ne l'efface pas**, la
  fermeture étant précisément ce qui la fait paraître dans la mention de section. La règle vaut
  pour **toute** surface partageant un état de mention avec ses voisines.

### 5.29 bis Les tableaux d'objectifs ARCHIVÉS dans la liste — `CRM-083` tranche 2 h

`docs/SPEC-goals.md` §5.6 dit ce que la liste montre et ce que la reprise fait ; ce paragraphe ne
dit que de quoi cela a l'air. **Il n'introduit aucune forme nouvelle** : tout ce qui suit est repris
sans écart du §5.13 et de l'administration de l'arborescence, où l'archivage pose le même problème.
C'est le point : deux écrans qui traitent le même état le traitent de la même façon, faute de quoi
l'utilisateur apprend deux grammaires pour une notion.

- **La bascule est une case à cocher étiquetée**, « Afficher les archivés », dans l'en-tête de la
  liste — même règle et même motif qu'au §5.3 quinquies : un bouton unique laisse toujours
  l'ambiguïté entre « ce que je fais » et « ce qui est ». Elle occupe une ligne de hauteur
  `--size-target`, sa case reste à **24 px** et son libellé lui sert de cible étendue (§5.7 bis).

- **Elle est rendue en toute circonstance, liste vide comprise.** Elle est la cause possible de ce
  vide — quelqu'un qui cherche un tableau archivé tombe précisément sur un écran vide —, et la
  masquer priverait l'utilisateur du seul geste qui l'en sort.

- **La mention « Archivé » est TEXTUELLE, jamais une teinte seule** (§5.13). Une ligne grisée ne dit
  pas pourquoi elle l'est, et un lecteur d'écran n'en lit rien. Elle se pose sous le compte de blocs,
  en `text-sm text-text-2`, comme la mention d'un track archivé.

- **Une ligne archivée n'est pas un lien.** Le canevas d'un tableau archivé n'est pas atteignable
  (`docs/SPEC-goals.md` §5.6.2, ligne e) : le rendre cliquable enverrait l'utilisateur sur un
  « tableau introuvable » que rien n'expliquerait. Le bloc de nom garde la même géométrie qu'un lien
  — `min-h-[var(--size-target)]`, même pile de lignes — pour que la colonne ne saute pas d'une ligne
  à l'autre.

- **Elle ne garde qu'une commande, « Désarchiver »**, icône `ArchiveRestore`. Les quatre autres sont
  **retirées**, et c'est le seul endroit du produit où une commande disparaît d'une ligne : ce n'est
  **pas** une extinction par rôle — le §5.26 l'interdit neuf fois, et la lectrice voit bien la
  commande, l'exerce et lit le refus — mais le retrait de gestes que l'**état de l'objet** rend sans
  effet observable. Renommer ou réordonner un tableau que la liste ne montre pas par défaut ne se
  verrait nulle part.

- **La reprise n'ouvre aucune confirmation.** La confirmation est réservée à ce qui coûte (§5.13) ;
  ce geste défait au lieu de détruire, et la demander apprendrait que les deux pèsent pareil.

- **Le refus d'écriture a son propre texte**, et ce n'est pas un doublon : celui de l'écriture
  ordinaire invoque « le tableau a peut-être été archivé entre-temps », ce qui est absurde sur une
  reprise — il l'est, et c'est ce qu'on défait. **Défaut trouvé en regardant une capture**
  (`CLAUDE.md` §16) : aucune assertion ne l'attrapait, le scénario ne vérifiant que l'absence du
  texte de succès.

- **La confirmation d'ARCHIVAGE est révisée dans le même geste.** Elle disait « aucun écran ne le
  rend plus », devenu faux : elle nomme désormais la case et la reprise. Une confirmation qui décrit
  un produit disparu dissuade d'un geste réversible.

- **LE REFUS DE DOUBLON NOMME LA CASE, ajouté le 2026-08-28 avec la décision 542.** Un tableau
  archivé retient son nom (`docs/SPEC-goals.md` §2.1 bis) : créer ou renommer sous ce nom est
  refusé, et le refus disait « choisissez-en un autre » — la seule issue qui restait tant que
  l'objet bloquant n'était rendu par aucun écran. Cette case l'a rendu atteignable, et le refus
  nomme donc la voie de recours avant le contournement.

  **La règle générale, applicable partout ailleurs :** quand un refus est causé par un objet que
  l'écran courant sait montrer, le texte du refus nomme le geste qui le montre. Il ne le décrit pas,
  il le NOMME par son étiquette exacte — ici « Afficher les archivés » —, pour que la phrase soit
  suivable sans traduction. Un refus qui tait un recours présent à l'écran enseigne le contournement
  d'un défaut qui n'existe plus, et c'est une forme discrète de l'écart que le `CLAUDE.md` §18
  proscrit : le produit se décrit alors moins capable qu'il n'est.

### 5.29 ter Le canevas d'objectifs en LECTURE SEULE — `CRM-083` tranche 3

`docs/SPEC-goals.md` §5.7 porte le contrat et ses quatre mesures ; ce paragraphe ne dit que de quoi
cela a l'air, et **surtout ce que cela ne relâche pas**.

**LA RÈGLE « AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE » N'EST PAS AMENDÉE.** Elle vise, aux §5.3,
§5.13, §5.16, §5.21, §5.23, §5.25, §5.26, §5.27 et §5.28, une extinction **selon le RÔLE** — une
déduction que l'écran fait à partir du jeton. Une **capacité que la base consent**, rendue comme une
colonne calculée, n'est pas un rôle : c'est une donnée de la ligne, au même titre que son nom. Le
§5.31 le fait déjà pour la table de saisie des coûts réels, avec `reel_saisissable` ; ce paragraphe
transpose la même forme au canevas, il n'en invente aucune.

**La frontière, en une phrase, et elle est la seule à retenir :** si l'écran doit LIRE UN RÔLE pour
éteindre, c'est interdit ; si la BASE lui dit sur la ligne qu'il ne peut pas écrire, l'éteindre est
la forme juste, et la taire serait une perte silencieuse.

**Mention de lecture seule.** En tête du canevas, sous la barre de titre, dans le bandeau
d'information neutre du §8 — `--color-surface-2`, texte `--color-text-1`, icône `Eye` de Lucide,
jamais `--color-danger` : ne pas pouvoir écrire n'est pas une erreur. Elle porte `role="status"`.
Elle dit ce que le tableau permet — le consulter — avant de dire ce qu'il refuse ; l'ordre inverse
se lit comme un reproche.

**Commandes désactivées et LISIBLES.** `disabled`, contraste conservé — jamais `opacity-50`, qui
ferait tomber le texte sous le seuil du §2 —, et chacune conserve son étiquette : une commande
éteinte qu'on ne peut plus lire n'apprend rien de ce qu'on pourrait faire ailleurs. Le motif n'est
**pas** répété sur chaque commande : il est dans la mention, une fois, et le `aria-describedby` de
chaque commande y renvoie.

**La fiche d'édition d'un bloc S'OUVRE quand même**, et ses champs sont désactivés. La refuser
retirerait la seule surface où le corps complet d'un bloc se lit — le canevas n'en montre qu'un
extrait (§5.29). Un écran qui rend la lecture plus pauvre pour empêcher une écriture punit le
lecteur d'un droit qu'il n'a pas demandé.

**Aucune ligne, aucun bloc, aucune flèche n'est masqué.** Comme au §5.31 : une surface qui cache ce
qu'elle ne peut pas écrire se lit comme complète alors qu'elle ne l'est pas.

**MAIS LA POIGNÉE DE REDIMENSIONNEMENT, ELLE, N'EST PLUS DESSINÉE — et la frontière est nette.**
Défaut trouvé en REGARDANT la première capture de la tranche 3 (`CLAUDE.md` §16) : le geste était
déjà inopérant, et la poignée restait visible avec son curseur `se-resize`, promettant un
redimensionnement que rien n'exécute — la commande morte du §5.21.

*Ce qui reste rendu, et ce qui part, en une règle réemployable :* **ce qui ENSEIGNE un geste reste
rendu et éteint ; ce qui ne fait que l'OFFRIR à la souris disparaît.** Une commande étiquetée
apprend au lecteur ce qu'il pourrait faire ailleurs, et l'éteindre suffit. Une poignée n'a ni
étiquette, ni nom accessible — elle est `aria-hidden` et hors tabulation —, elle n'apprend donc
rien : la garder ne fait que mentir au curseur. Le « rien n'est masqué » ci-dessus porte sur ce qui
se LIT — blocs, flèches, valeurs, libellés —, jamais sur une affordance muette.

### 5.30 Histogramme prévisionnel / réel — `CRM-086`

Spécifié avant code, `docs/SPEC-costs.md` §4.2.

**Deux barres adjacentes par budget**, séparées de 4 px, groupes séparés de 24 px.

| Série | Jeton |
|---|---|
| Prévisionnel | `--color-brand` |
| Réel | `--color-success` |
| Réel **dépassant** le prévisionnel | `--color-danger`, sur la seule barre concernée |

**La couleur ne porte jamais seule l'information** (§1) : chaque barre affiche sa valeur en clair
au-dessus, la légende nomme les deux séries, et un **tableau équivalent** est rendu sous le
graphique — c'est lui que lira un lecteur d'écran, et lui qui reste juste si la couleur ne passe pas.

**Axe et échelle.** L'axe des valeurs part de zéro, toujours ; une échelle tronquée exagère
visuellement un écart et ferait mentir la comparaison qui est l'objet même de cet écran.

**Mention des réels manquants.** Sous le graphique, en 13 px `--color-text-2` : « n lignes sans coût
réel saisi, pour m € de prévisionnel ». Elle est **obligatoire** dès qu'une ligne n'a pas de réel.
Sans elle, un réel bas se lit comme une économie alors qu'il n'est qu'une saisie en retard.

**État vide.** Un budget sans ligne rend deux barres nulles **et** la phrase « aucune dépense
rattachée » : deux barres à zéro sans texte se lisent comme un défaut d'affichage.

**L'état vide se lit sur le COMPTE DE LIGNES, jamais sur les montants — ajouté le 2026-08-19,
décision 476.** Un agrégat qui ne porterait que des montants ne distingue pas « aucune dépense » de
« des dépenses qui s'annulent » : le §2.1 de `docs/SPEC-costs.md` admet l'avoir, donc le coût
négatif, et une ligne de 0 saisie exprès est légitime (§4.8). Écrire « aucune dépense rattachée »
sur un budget qui en porte deux serait la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.
*Défaut mesuré : la condition portait d'abord sur l'absence de tout budget, et un budget réellement
vide gardait ses deux barres nulles en se taisant.*

**L'ÉTIQUETTE D'UNE BARRE PORTE SON PROPRE REMBOURRAGE HORIZONTAL — 4 px —, ET C'EST UN DÉFAUT
TROUVÉ EN REGARDANT UNE CAPTURE** (`CLAUDE.md` §16, 2026-08-19). Les deux barres d'un groupe sont
séparées de 4 px, mais leurs étiquettes sont plus larges qu'elles — « 1 000 € » pour 32 px de barre
— et se rejoignaient donc à l'œil : « 1 000 €880 € » se lisait comme un seul nombre. C'est le défaut
« Discussion1 » du §5.11 sous une autre forme, et le remède est le même — l'espace vit dans
l'élément, il ne se devine pas. Le rembourrage porte sur l'**étiquette**, jamais sur le groupe : les
barres gardent les 4 px que ce paragraphe leur donne. La règle vaut pour **toute** valeur en clair
posée au-dessus d'une forme plus étroite qu'elle.
**L'EN-TÊTE DE LIGNE DU TABLEAU ÉQUIVALENT EST ALIGNÉ À GAUCHE, ET C'EST UN DÉFAUT TROUVÉ EN
REGARDANT UNE CAPTURE** (`CLAUDE.md` §16, 2026-08-20). Un `th` est **centré par défaut**, et la
classe d'alignement posée sur la ligne d'en-tête ne porte que sur les cellules de celle-ci : les
libellés du corps se rendaient donc centrés, entre un en-tête aligné à gauche et un pied « Total »
qui, lui, posait son alignement explicitement. Le §5.9 pose « texte à gauche » sans exception pour
un en-tête de ligne. Le défaut datait de la première livraison du composant et ne s'est vu qu'avec
la **précision** rendue sous le libellé — deux lignes centrées se remarquent là où un mot seul
passait. La règle vaut pour **tout** `th scope="row"` du produit : l'alignement s'écrit sur la
cellule, il ne s'hérite pas de l'en-tête.

**LE LIBELLÉ D'UN GROUPE PEUT ÊTRE UN LIEN, ET CE LIEN VIT DANS LE TABLEAU — jamais sur la barre**
(ajouté le 2026-08-20 par la tranche 4). Le graphique est `aria-hidden` : une cible interactive
posée dessus serait perdue au clavier comme au lecteur d'écran, ce que le §8 interdit sans
exception. Le tableau étant la version accessible du graphique, c'est lui qui porte le geste. Le
**nom accessible du lien est distinct du libellé visible** — « Voir le détail du budget X » et non
« X » : cinq liens ne portant que leur libellé ne diraient pas ce que chacun ouvre, la règle du
§5.29 pour les commandes répétées d'une liste.

### 5.31 Table de saisie en série des coûts réels — `CRM-086`

Spécifiée avant code, `docs/SPEC-costs.md` §4.8.

**Onglets.** Les écrans de coûts portent deux onglets — « Vue d'ensemble » et « À saisir » —, dans
le style d'onglets déjà employé par la fiche d'affaire. L'onglet « À saisir » porte un **badge**
neutre avec le nombre de lignes en attente ; le badge disparaît à zéro plutôt que d'afficher `0`.

**Table.** Réemploie le tableau de données du §5.9 — en-tête collant, lignes de 44 px, alignement à
droite des montants. La colonne « Réel » porte un **champ de saisie** aligné à droite, largeur fixe,
qui s'enregistre pour lui-même selon le §5.7 ter : les trois mentions — « Enregistrement… »,
« Enregistré », le refus — vivent **sous le champ, dans la ligne**, jamais en tête d'écran.

**Clavier, et c'est la raison d'être de cet écran.** `Entrée` valide et porte le focus sur le champ
« Réel » de la **ligne suivante**. `Échap` annule la saisie en cours et laisse la ligne intacte. La
tabulation ne quitte pas la colonne de saisie tant qu'il reste des lignes : un écran de saisie en
série qui oblige à traverser six colonnes par ligne n'est pas un écran de saisie en série.

**Une ligne enregistrée reste en place**, sur un fond `--color-success-soft` qui s'estompe, jusqu'au
prochain chargement de l'onglet. **Elle ne quitte jamais la table à chaud** : les lignes suivantes
remonteraient sous le curseur et la valeur suivante serait écrite au mauvais endroit.

**Ancienneté.** Première colonne, en 13 px `--color-text-2`, formulée en durée — « 12 jours ». Au
delà d'un seuil, elle passe en `--color-danger-on-soft` sur `--color-danger-soft`, comme la pastille
d'ancienneté d'une card (§5.1) : c'est le même signal, il doit avoir la même forme.

**LE SEUIL EXISTE DEPUIS LE 2026-08-29, ET C'EST UNE DONNÉE — arbitrage d'INC-183,
`docs/SPEC-costs.md` §2.1 bis.** Ce paragraphe a vécu neuf jours en promettant une variante que rien
ne pouvait déclencher : `docs/SPEC-costs.md` §4.8.1 point 2 nommait l'écart et livrait la colonne
neutre. Le seuil est désormais `budgets.stale_after_days`, réglé au formulaire d'administration du
budget (§5.9, `docs/SPEC-costs.md` §4.1), et la variante obéit à **trois** états et non à deux :

- **le budget déclare un seuil et l'ancienneté le dépasse STRICTEMENT** → `--color-danger-on-soft`
  sur `--color-danger-soft`, la forme exacte de la pastille du §5.1 ;
- **le budget déclare un seuil non franchi** → rendu neutre ;
- **le budget ne déclare AUCUN seuil** → rendu neutre, et il le reste à mille jours. *Un seuil
  absent ne devient jamais un seuil par défaut* (`docs/SPEC-relances.md` §2.2) : c'est déjà la règle
  de la pastille d'une card sur une étape sans seuil, et deux signaux de même forme ne peuvent pas
  suivre deux doctrines contraires.

**LA TEINTE EST PORTÉE PAR LA VALEUR, JAMAIS PAR LA CELLULE — défaut TROUVÉ EN REGARDANT LA CAPTURE
le 2026-08-29** (`CLAUDE.md` §16, `docs/captures/CRM-084/anciennete-seuil-1440.jpg`), et la règle
générale qui en sort vaut pour tout signal chromatique posé dans un tableau du §5.9. Posée sur la
cellule, la teinte peignait **toute la largeur de la colonne** — cent quinze pixels de fond rouge
derrière quatre caractères —, et la ligne entière se lisait comme une ligne en erreur, ce qu'elle
n'est pas : c'est une valeur qui est signalée, pas un enregistrement qui est fautif. Une pastille se
moule sur sa valeur. La forme retenue est donc celle de la pilule « clôturé » de la colonne d'à côté
— `inline-flex`, `rounded-full`, `px-2` —, qui vit déjà dans cette table : **deux pastilles d'un même
tableau qui ne se ressembleraient pas se liraient comme deux natures de chose.** Une assertion mesure
que la pastille est plus étroite que sa cellule, faute de quoi le défaut reviendrait sans bruit.

Les deux derniers états sont **visuellement identiques et sémantiquement distincts** ; c'est assumé,
et c'est pourquoi la teinte n'est pas la seule chose qui parle. Le **nom accessible** de la cellule
porte la distinction — « 120 jours, au delà du seuil de 30 jours fixé pour ce budget » contre
« 12 jours » —, faute de quoi le signal ne serait lisible qu'à l'œil, ce que le §8 interdit : une
information portée par la seule couleur n'existe pas pour qui ne la distingue pas.

**Pilule « clôturé »** sur les lignes dont le budget ou l'occurrence est clos — badge neutre du
§5.6, jamais `--color-danger` : un budget clos n'est pas une erreur, et sa ligne reste saisissable.

**Lecture seule.** Une ligne que l'appelant ne peut pas écrire rend son champ **désactivé et
lisible**, avec le motif sous le champ — §8. Elle n'est jamais masquée : une table qui cache des
lignes se lit comme complète alors qu'elle ne l'est pas.

**Ce que la LIVRAISON de la tranche 6b a ajouté à ce paragraphe, le 2026-08-20.** Cinq règles, dont
quatre corrigent ce que la rédaction d'avant-code supposait.

- **La barre d'onglets est rendue QUEL QUE SOIT l'état de la vue d'ensemble.** Les deux lectures
  sont indépendantes : un histogramme en erreur, ou un track sans aucun budget ouvert, retirerait
  sinon l'accès à un onglet dont les lignes existent — et l'onglet « À saisir » liste précisément
  les budgets **clôturés** que l'histogramme exclut. C'est la règle du §5.3 quinquies pour la barre
  de filtres, transposée à une navigation : un contrôle qui est la cause possible d'un vide reste
  rendu.

- **`aria-current` est posé À LA MAIN, et non par `NavLink`.** Les deux entrées partagent le même
  chemin et ne diffèrent que par leur chaîne de requête (`?onglet=saisir`, `docs/SPEC-costs.md`
  §4.0), que `NavLink` ne compare pas : il poserait l'attribut sur les **deux** entrées. C'est le
  seul endroit du produit où deux liens de navigation ne se distinguent pas par leur chemin, et
  c'est la conséquence directe du §4.0. Tout le reste du patron du §12.1 est tenu sans écart.

- **Le badge est ABSENT tant que le compte n'est pas connu**, et pas seulement à zéro. Le §5.31
  écrivait « le badge disparaît à zéro plutôt que d'afficher `0` » ; il manquait l'état
  intermédiaire — pendant la lecture, un badge « 0 » affirmerait que tout est saisi alors que rien
  n'a été lu, ce qui est la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.

- **LE FOND DE SUCCÈS NE S'ÉTEINT PAS SUR UN MINUTEUR.** Ce paragraphe écrivait « un fond
  `--color-success-soft` qui s'estompe » ; le §4.8 de la spécification, lui, écrit que la ligne
  « reste affichée, marquée *enregistré*, **jusqu'au prochain chargement de l'onglet** ». Les deux
  ne peuvent pas être vrais ensemble : une marque qui s'efface d'elle-même rend la table
  indistinguable de son état d'avant, et le minuteur qui l'effacerait serait la temporisation
  arbitraire que `CLAUDE.md` §18 proscrit. Le fond **s'installe** avec la transition de couleur du
  §3 et **demeure**, comme la mention « Enregistré » qui l'accompagne.

- **UNE LIGNE GAGNE DE LA HAUTEUR QUAND SA MENTION PARAÎT, et c'est l'écart assumé avec le §5.9.**
  Ce paragraphe pose des lignes de 44 px ; il pose aussi que les trois mentions du §5.7 ter vivent
  « sous le champ, **dans la ligne** ». Les deux ne tiennent pas ensemble dès que la mention est
  longue — « Vous ne pouvez pas modifier cette affaire. » se rend sur deux lignes, observé à la
  capture `docs/captures/CRM-086/couts-a-saisir-lecture-seule-1440.jpg`. C'est le même écart que le
  §5.21 assume pour sa liste plate, et il est pris ici pour la même raison : la mention se lit près
  du champ qu'elle concerne, et la rejeter hors de la ligne ferait chercher à quelle ligne elle
  appartient. Les 44 px restent la hauteur d'une ligne **au repos**, cellules alignées en haut.

- **LE BADGE DIT CE QU'IL COMPTE, ET L'ONGLET « Vue d'ensemble » ÉCRIT SA PORTÉE — ajouté le
  2026-08-28 par l'arbitrage d'INC-182** (`docs/SPEC-costs.md` §4.8.3). Le badge et la mention
  « n lignes sans coût réel saisi » du §4.4 comptent deux populations différentes — la première
  inclut les budgets clôturés et confond les devises, la seconde est rendue sous un histogramme qui
  exclut les uns et sépare les autres. Deux nombres différents sur un même écran se lisent comme une
  erreur de calcul tant que rien ne dit ce que chacun compte. Donc : le **nom accessible** du badge
  nomme sa population entière — « n ligne(s) en attente de leur coût réel, budgets clôturés compris,
  toutes devises confondues » —, et une phrase de portée en 13 px `--color-text-2` est rendue **sous
  la barre d'onglets**, sur le seul onglet « Vue d'ensemble », **dès que le badge paraît**. C'est la
  règle du §5.33 pour le cumul du workspace — *la portée d'un nombre est écrite à l'écran* —,
  appliquée à un compte plutôt qu'à un total. Elle n'est **pas** conditionnée à une divergence
  observée : la mesurer demanderait à l'onglet de recompter la population de l'histogramme, donc de
  tenir une seconde source pour un même nombre.

- **La tabulation traverse UNE cible par ligne, et non aucune.** Ce paragraphe écrivait que « la
  tabulation ne quitte pas la colonne de saisie tant qu'il reste des lignes » ; la colonne
  « Affaire » porte un **lien**, seule autre cible de la ligne, et l'ôter du parcours de tabulation
  le rendrait inatteignable au clavier — ce que le §8 interdit sans exception. Ce que la règle
  visait est tenu : on ne traverse pas six colonnes par ligne, et c'est `Entrée` qui porte la
  série, en menant d'un champ « Réel » au suivant sans passer par rien d'autre.

### 5.32 Écran de détail d'un budget — `CRM-086`

Spécifié avant code, `docs/SPEC-costs.md` §4.3. Livré le 2026-08-20. L'écran réemploie
l'histogramme du §5.30 et le tableau de données du §5.9 ; les règles ci-dessous ne disent que ce
qui lui est propre.

- **Trois blocs dans cet ordre : l'identité du budget, l'histogramme, la liste de ses lignes.** On
  lit ce qu'est l'enveloppe avant de lire comment elle se dépense, et le détail ligne à ligne après
  la vue d'ensemble — le même ordre que la fiche d'affaire, dont l'en-tête précède le dossier
  (§5.3 bis).

- **L'identité est une liste de définitions (`dl`), pas un tableau** (§5.20) : devise et enveloppe
  sont des couples terme / valeur qui ne se comparent pas entre eux. Elles sont des **données
  techniques** (§2), en monospace à chiffres tabulaires. Deux colonnes à partir de `md`, empilées
  en dessous — `md` et jamais `sm`, qui est un variant inconnu que Tailwind supprime en silence
  (§11, §5.20).

- **UNE ENVELOPPE NON RENSEIGNÉE NE REND AUCUNE LIGNE**, elle ne rend pas une ligne vide. Le §2.1
  la déclare facultative, et un blanc se lirait comme une enveloppe nulle : c'est la distinction
  entre « ne se prononce pas » et « vaut zéro » que le §5.18 tient déjà pour un attribut de nœud.

- **La pilule « clôturé » emploie les jetons NEUTRES**, `--color-hover` / `--color-text-2`, jamais
  `--color-danger` — la règle du §5.31 : un budget clos n'est pas une erreur, et ses lignes restent
  lisibles et leur coût réel saisissable. Elle **nomme la conséquence** plutôt que l'état seul, sans
  quoi « clôturé » se lirait comme une fermeture de la lecture.

- **UNE PAIRE DE BARRES PAR OCCURRENCE, ET UNE OCCURRENCE MUETTE GARDE LA SIENNE, À ZÉRO.** Le §4.3
  demande « une paire par occurrence », pas « par occurrence dépensée » : qu'il ne se soit rien
  passé sur une période est une information, et la faire disparaître ferait lire le budget comme
  s'il n'avait jamais porté ce mois-là. Un budget non récurrent rend une paire unique, nommée
  « Sans occurrence ».

- **La période se rend en PRÉCISION sous le libellé de l'occurrence**, dans le champ que le §5.30
  déclare, et **composée par une clé de traduction** : les deux bornes sont facultatives et
  indépendantes (§2.2), donc trois formes existent, et « du … au … » ne se construit pas en collant
  deux dates (§10). Elle dit ce que le libellé ne garantit pas — rien n'oblige « Janvier 2026 » à
  couvrir janvier.

- **Le filtre par occurrence est un `select` du §5.7, avec une option vide en tête** qui est le
  moyen de le LEVER (§5.22). Il **n'existe que s'il y a quelque chose à filtrer** — la règle du
  §5.11 pour la barre de filtres du fil : un budget non récurrent, ou un budget récurrent sans
  occurrence, n'en rend aucun.

- **LE FILTRE RETIENT LA LISTE, JAMAIS LE GRAPHIQUE.** Masquer une paire de barres ferait perdre la
  comparaison entre occurrences, qui est l'objet même de cet écran ; la liste, elle, est ce que le
  §4.3 déclare filtrable.

- **Deux vides distincts, et aucun ne se confond avec l'autre** (§5.11) : « aucune dépense
  rattachée à ce budget » et « aucune dépense sur cette occurrence ». Les fondre ferait passer un
  filtre trop restrictif pour un budget sans histoire.

- **La liste porte CINQ colonnes, celles que la spécification énumère** — affaire, nature,
  prévisionnel, réel, auteur. Aucune colonne « occurrence » : c'est le filtre qui porte cette
  dimension, et l'histogramme juste au-dessus la donne déjà.

- **UN COÛT RÉEL NON SAISI LAISSE SA CELLULE VIDE** (§5.9) : ni tiret, ni « non renseigné », ni
  zéro. Le §2.3 pose que « nul n'est pas zéro », et un `0 €` transformerait un retard de saisie en
  dépense nulle — la principale façon dont cet écran mentirait. Le compte de ces lignes est porté
  par la mention du §4.4 sous l'histogramme, jamais par la cellule.

- **« Auteur inconnu » est un TEXTE, pas une cellule vide** — la règle du §5.16 : `created_by` est
  `on delete set null`, et un profil supprimé laisse un fait à nommer.

- **Le titre de l'affaire est un lien quand elle est adressable, et un texte sinon.** Une affaire
  dont les slugs manquent reste **listée** — la masquer retrancherait un montant du tableau —, mais
  sans lien : un lien vers une adresse incomplète mènerait à un écran que l'utilisateur croirait
  cassé (§5.10). Une **affaire archivée garde son lien** et porte sa pilule (§5.24).

- **Les cinq états du §5.8 sont traités**, et le troisième est le plus important : **budget
  introuvable** est le **même** écran pour un identifiant inconnu, pour un appelant sans droit et
  pour une adresse mal formée (`docs/SPEC-permissions-rls.md` §7). Son action de retour mène aux
  **coûts du track**, jamais à la racine : c'est de là qu'on vient, et c'est là que les autres
  budgets se trouvent.

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : l'écran emprunte au §5.30 son
  histogramme, au §5.9 son tableau, au §5.6 sa pilule et au §5.5 son lien de retour.

### 5.33 Cumul des coûts du workspace — `CRM-086`

Spécifié avant code, `docs/SPEC-costs.md` §4.5. Livré le 2026-08-20. L'écran réemploie
l'histogramme du §5.30 ; les règles ci-dessous ne disent que ce qui lui est propre.

- **Une entrée transverse de la barre latérale (§4), et non une section de `/reglages`.** C'est le
  raisonnement qui a déjà placé le carnet (§5.19) et les objectifs hors des réglages : un
  histogramme de coûts n'administre rien, il porte le travail. Son icône est **`ChartColumn`, la
  même que l'entrée « Coûts » de la barre d'onglets d'un track** (§12.1) : le §9 interdit que deux
  objets **distincts** partagent une icône, et ces deux entrées désignent le **même** objet à deux
  portées différentes. Leur en donner deux ferait chercher deux choses là où il n'y en a qu'une.

- **Il ne porte pas de coquille propre**, à la différence des deux autres écrans de coûts (§5.32) :
  son titre est une clé de traduction et son contenu ne dépend d'aucun paramètre d'adresse. C'est
  exactement le critère qui range son adresse dans `ROUTES` là où les deux autres suivent le patron
  de `CHEMIN_CARD`.

- **UN GROUPE DE BARRES PAR TRACK, cumulant ses budgets ouverts** — jamais par budget, qui est la
  lecture du §5.30 à l'échelle d'un track. Un track dont deux budgets vivent dans la même devise
  rend **une** paire de barres, et la comparaison porte alors sur les tracks entre eux.

- **UN TRACK SANS BUDGET OUVERT NE REND AUCUNE BARRE, et ce n'est pas un état vide.** Une paire de
  barres vit dans l'histogramme d'une devise ; un track sans budget n'en porte aucune, et l'y placer
  demanderait d'inventer sa monnaie. L'état vide du §5.8 est réservé au cas où **aucun** track n'en
  porte.

- **CHAQUE HISTOGRAMME PORTE SON TITRE DE DEVISE — `h2` — DÈS QU'IL Y EN A PLUSIEURS, ET C'EST UN
  DÉFAUT TROUVÉ EN REGARDANT UNE CAPTURE** (`CLAUDE.md` §16, 2026-08-20). Cet écran est la
  **première** surface du produit où deux histogrammes s'empilent réellement : un track n'a en
  pratique qu'une devise, si bien que le §5.30 n'avait jamais rendu le cas. Les deux blocs se
  suivaient avec la **même** légende et les **mêmes** en-têtes de colonne, et rien à l'œil ne disait
  que le second comptait des francs — la devise ne se lisait que dans les montants, c'est-à-dire là
  où on ne la cherche pas. Le nom accessible de la région le disait déjà (§5.30), mais **un nom de
  région n'est pas rendu à l'écran**. Le titre est en revanche **absent** quand une seule devise est
  présente : le §4.5 pose que « s'il n'y en a qu'une — le cas attendu —, l'utilisateur ne voit rien
  de cette mécanique », et un titre permanent serait du bruit à chaque ouverture.

- **LA PORTÉE DU CUMUL EST ÉCRITE SOUS LES HISTOGRAMMES**, en 13 px `--color-text-2`, à la place et
  dans la graduation de la mention du §4.4, qui est de la même nature. Elle n'est **pas** un
  avertissement à franchir avant de lire : c'est une note de lecture des nombres qu'on vient de
  lire. Sa nécessité vient du §4.5 — le total est calculé **après** la RLS, donc deux profils lisent
  deux nombres différents sur les mêmes données —, et sans elle l'écart se lirait comme une erreur
  de calcul. Elle n'est **pas rendue sur l'état vide**, où il n'y a aucun nombre à qualifier.

- **L'écran ne nomme JAMAIS ce qu'il ne montre pas.** Aucune phrase ne dit « un budget vous est
  masqué », et l'état vide ne distingue pas « aucun track lisible » de « aucun budget ouvert » : les
  deux divulgueraient par la bande ce que la RLS ferme (`docs/SPEC-permissions-rls.md` §7). C'est la
  règle que le canevas d'objectifs tient déjà pour un bloc masqué (§5.29).

- **Le libellé d'un track est un LIEN vers ses coûts** (§4.0), posé dans le tableau équivalent et
  jamais sur la barre `aria-hidden` — la règle du §5.30, tenue à l'identique. Sans lui, cet écran
  serait une impasse : on y lirait qu'un track dépense sans aucun moyen d'aller voir quels budgets.
  Le nom accessible est distinct du libellé visible — « Voir les coûts du track X ».

- **L'état vide n'offre AUCUNE action**, comme celui de l'écran du track : la création d'un budget
  vit dans l'administration de l'arborescence (`docs/SPEC-costs.md` §4.1), et y renvoyer
  conditionnellement au rôle ferait calculer un droit à l'interface (`CLAUDE.md` §10).

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : l'écran emprunte au §5.30 son
  histogramme, au §12.1 son icône et au §5.8 ses états.

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

**RÉVISION DU 2026-08-19 — `CRM-086`.** La barre ne porte plus que des channels. L'entrée « Coûts »
du §4.0 de `docs/SPEC-costs.md` désigne un écran du **track entier** ; elle emprunte le même patron
— lien, `aria-current="page"`, bordure basse de même épaisseur dans les deux états — parce que c'est
le même geste de navigation, et elle est **séparée** par un filet et par une seconde `nav` étiquetée
parce que ce n'est pas le même objet. Deux conséquences que la révision assume :

- **l'état vide de la barre ne suffit plus à décrire un track sans channel.** Il reste rendu, il
  reste vrai, et l'entrée transverse est rendue à côté de lui ;
- **la barre porte désormais deux points de repère de navigation**, chacun avec son propre nom
  accessible — « Onglets » et « Vues du track ». Un `nav` sans nom, ou deux `nav` de même nom,
  seraient indiscernables au lecteur d'écran (§8).

L'icône `ChartColumn` **accompagne** le libellé et ne le remplace pas (§9).

### 12.2 Ordre de sacrifice dans l'en-tête sous 768 px — `CRM-007`, révisé par `CRM-065`

Sous le palier `md`, l'en-tête abandonne d'abord le **nom du produit** et le **contexte
d'espace de travail**, jamais le **titre de la route**. Motif : les deux premiers sont portés
ailleurs — barre latérale, onglet du navigateur —, le titre de la route ne se déduit de rien.
Défaut réellement observé sur une capture avant correction : à 390 px, le titre disparaissait au
profit du contexte, contre le §7 (« aucun contenu n'est masqué sans point d'accès »).

**RÉVISION DU 2026-08-27 — `CRM-065`. LE NOM DU PRODUIT CÈDE DÉSORMAIS SOUS `lg`, ET NON SOUS
`md`.** L'ordre de sacrifice est **inchangé** ; seul son **seuil** descend d'un palier, et c'est une
mesure qui l'impose — établie par **comparaison à la ligne de base** (`docs/CloudWorker.md` §2.4),
la capture `docs/captures/CRM-076/workflows-md-900.jpg` du commit d'avant la livraison :

| État | Ce que l'en-tête rend à 900 px |
|---|---|
| avant `CRM-065` | `P2Enjoy CRM / ` **Éditeur de workflows** |
| avec la commande de recherche, seuil `md` | `P2Enjoy CRM / ` **Éditeur de wor…** |
| avec la commande de recherche, seuil `lg` | **Éditeur de workflows** |

**La cause n'est pas le CHAMP — il n'apparaît qu'à partir de `lg` (§5.46) — c'est la COMMANDE À
ICÔNE**, quarante pixels de plus sur une ligne qui n'en avait plus. Le nom du produit est `shrink-0`
et ne cède pas : c'est donc le titre qui paie. C'est exactement le défaut que ce paragraphe avait
déjà mesuré à 390 px avant `CRM-007`, reparu un palier plus haut par l'arrivée d'un nouvel occupant
de la ligne.

La règle générale qui en sort, et qui vaut au-delà de cet en-tête : **un élément `shrink-0` posé
dans une ligne partagée déplace le manque de place sur ses voisins élastiques**, et le seuil auquel
il doit céder se recalcule à chaque nouvel occupant de la ligne.

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

### 5.23 Formulaire de création d'un contact — `CRM-060`

Le geste de création du carnet (`docs/SPEC-contacts.md` §14). Il **hérite du §5.21** — le bloc des
contacts d'une affaire — plutôt que d'inventer une forme : mêmes règles, même motif.

- **Dans le FLUX du document, jamais une modale**, entre le titre et le tableau. Une modale
  recouvrirait la liste que l'on vient de lire, or **cette liste est précisément ce qui dit si le
  contact existe déjà**.
- **Replié par défaut.** Le carnet est d'abord une surface de lecture ; un formulaire toujours
  déplié pousserait le tableau sous la ligne de flottaison à chaque visite.
- **Le focus entre** sur le premier champ à l'ouverture, et **revient** à la commande d'ouverture à
  la fermeture (§8).
- **Aucune commande éteinte d'avance selon le rôle** : la lectrice voit le geste, envoie, et reçoit
  le refus **traduit**. Une commande grisée ferait passer une décision de la base pour une décision
  d'écran.
- **Un refus n'efface jamais la saisie**, et son message vit **sous** le formulaire, près de ce qui
  l'a causé (§5.13).
- **Le sélecteur d'organisation suit les états du §13.5** — cas h et i : liste illisible → contrôle
  désactivé avec action de reprise ; liste vide → option vide seule, mention **sans** action, aucune
  surface ne créant d'organisation.
- **L'état vide du carnet offre désormais ce geste**, et c'est une **révision par livraison** de la
  règle du §5.19 : « l'état vide n'offre aucune action » tenait tant qu'aucun geste de création
  n'existait. Un carnet vide est précisément celui où l'on veut ajouter un contact.

### 5.24 Fiche de contact — `CRM-060`

Surface de **détail** atteinte depuis le carnet (§5.19) et depuis la fiche d'organisation (§5.20),
jamais depuis la barre latérale : le carnet est la liste qui la peuple. Ce que l'écran lit est
spécifié par `docs/SPEC-contacts.md` §15 ; les règles ci-dessous ne disent que de quoi il a l'air.

- **Deux zones, et le patron du §5.20 tenu à l'identique.** Ce qui caractérise le contact —
  fonction, organisation, email, téléphone — est une **liste de définitions** (`<dl>`) à deux
  colonnes à partir de `md`, empilée en dessous. Ses affaires sont des lignes homogènes et
  reprennent le **tableau du §5.9**, à **trois** colonnes : affaire, rôle dans l'affaire, état.

  **Trois colonnes et non cinq** : le track et le channel d'une affaire sont dans son **adresse**,
  et les poser en colonnes remplirait la ligne d'une information que le clic donne déjà.

  Le palier est `md`, jamais `sm` — même motif qu'au §5.20 : `sm` est un variant inconnu que
  Tailwind supprime sans rien signaler (§11, §12.5).

- **Le nom du contact est le titre de la route** : une **donnée**, portée par `titreRoute` de la
  coquille et non par une clé de traduction (§10), avec une clé de repli pendant le chargement.

- **`email` et `phone` sont des données techniques** (§2) : monospace. **`role_title` n'en est
  pas une** — c'est un intitulé de fonction, du texte ordinaire, et le rendre en monospace lui
  donnerait l'apparence d'un identifiant. Une valeur absente laisse la valeur **vide** — ni tiret,
  ni « non renseigné » —, la règle du §5.9.

- **Deux liens, et leurs deux règles.** L'**organisation** mène à sa fiche (§5.20), et reste
  **vide et sans lien** quand le contact n'en a aucune. Le **titre d'une affaire** mène à cette
  affaire ; il est toujours un lien, l'adresse étant construite dans la même lecture.

- **Une affaire archivée porte une pilule « Archivée »** (§5.6), précédée d'une icône afin que
  l'information ne repose jamais sur la seule couleur, et **reste atteignable** : une affaire
  archivée est une affaire réelle, et l'historique d'un contact est ce que cette page sert. Une
  affaire **à la corbeille** n'est pas listée du tout — la corbeille (§5.16) est la surface qui en
  répond.

- **Cinq états, tous traités** (§5.8). Squelettes pendant la lecture ; erreur avec reprise qui
  relit réellement ; **contact introuvable**, qui porte un retour vers le carnet et qui est le
  **même** écran pour un identifiant inconnu, pour un appelant sans droit et pour une adresse mal
  formée (`docs/SPEC-permissions-rls.md` §7) ; **zone des affaires vide** — sans action, cette
  surface ne livrant aucun geste.

  **La zone vide est AUSSI l'écran d'un lecteur restreint**, et c'est délibéré : les droits fins de
  `cards` retirent les affaires que l'appelant ne peut pas lire, et l'écran n'a donc aucun refus à
  mettre en scène (§5.8, `docs/SPEC-contacts.md` §15.4).

- **Le conteneur du tableau porte `.indique-debordement-x`** (§12.6), comme le §5.19 et le §5.20.

- **RÈGLE RÉVISÉE PAR LIVRAISON, 2026-08-19.** Cette surface ne livrait « aucun geste », et son
  état vide n'offrait donc aucune action. La sous-tranche 4g livre le geste de **modification**
  (§5.25) : la fiche porte désormais une commande, posée avant les deux zones. Ce qui reste vrai,
  et qui est ce que la règle visait, est plus étroit : **l'état vide de la zone des affaires
  n'offre toujours aucune action**, aucun rattachement n'étant livré depuis cette page.

  > **RÉVISION SUIVANTE, 2026-08-19** (`docs/SPEC-contacts.md` §17.6). La condition que la phrase
  > ci-dessus avait resserrée **tombe à son tour, par livraison** : la sous-tranche 4h pose le geste
  > de **rattachement** dans la zone des affaires (§5.26), et **son état vide garde donc ce geste**
  > — c'est lui qui le comble, la règle du §5.13 pour l'état vide d'une surface qui agit, déjà tenue
  > par le §5.21 et par le §5.23. Ce qui reste vrai est plus étroit encore, et c'est le seul énoncé
  > que 4h ne révise pas : **aucun détachement n'est livré depuis cette page** (§17.8), et une
  > ligne du tableau ne porte donc toujours aucune commande.
  >
  > > **RÉVISION FINALE, 2026-08-19** (`docs/SPEC-contacts.md` §18.4). Le dernier énoncé **tombe à
  > > son tour, par livraison** : la sous-tranche 4i pose une **quatrième colonne** au tableau, et
  > > **chaque ligne porte désormais sa commande de détachement** (§5.27). Le tableau du §5.24 se
  > > lit donc à **quatre** colonnes — affaire, rôle, état, commandes —, et le motif des « trois
  > > colonnes et non cinq » est **inchangé** : il visait les colonnes de **donnée**, le track et le
  > > channel restant dans l'adresse. Ce qui reste vrai, et que 4i ne révise pas : **l'état vide de
  > > la zone des affaires ne gagne aucune commande de détachement** — un tableau sans ligne n'en a
  > > aucune à porter —, et il garde le seul geste de rattachement du §5.26.
  > >
  > > > **RÉVISION DU 2026-08-19 — sous-tranche 4j** (`docs/SPEC-contacts.md` §19.4). La quatrième
  > > > colonne porte désormais **DEUX** commandes par ligne — « Modifier le rôle », puis
  > > > « Détacher » (§5.28) —, et son en-tête, déjà au pluriel, ne change pas. Le **nombre de
  > > > colonnes ne bouge pas** : le tableau se lit toujours à quatre, et le motif des « trois
  > > > colonnes et non cinq » reste inchangé, puisqu'il visait les colonnes de **donnée**. La
  > > > **cellule du rôle devient modifiable en place**, ce qu'elle n'était pas. Ce qui reste vrai,
  > > > et que 4j ne révise pas : **l'état vide de la zone des affaires ne gagne aucune commande** —
  > > > un tableau sans ligne n'a aucun rôle à modifier —, et il garde le seul geste de rattachement
  > > > du §5.26.

### 5.25 Formulaire de modification d'un contact — `CRM-060`

Le geste d'édition de la fiche de contact (`docs/SPEC-contacts.md` §16). Il **hérite du §5.23** —
le formulaire de création — plutôt que d'inventer une forme : mêmes champs, mêmes règles, même
motif. Ce qui suit ne dit que ce qui lui est propre.

- **Dans le FLUX du document, jamais une modale**, entre le titre de la route et la zone des
  caractéristiques. Le motif est celui du §5.23, transposé : **ce que la fiche affiche est
  précisément ce que l'on vient corriger**, et une modale le recouvrirait. Les deux zones de
  lecture restent rendues **sous** le formulaire.
- **Replié par défaut**, et **la commande et le formulaire s'excluent** : ouvrir remplace le
  bouton, refermer le remonte.
- **Les champs sont PRÉREMPLIS** des valeurs courantes. Une colonne nulle donne un champ **vide**,
  jamais le texte « null » : c'est la règle du §5.9 appliquée à la saisie.
- **Le focus entre** sur le champ du nom, et **revient** à la commande d'ouverture à la fermeture
  (§8). Ce retour est **différé d'un tour de rendu** : la commande étant démontée pendant que le
  formulaire est ouvert, l'appeler depuis le gestionnaire de fermeture viserait une référence nulle
  et laisserait le focus sur le document. C'est le défaut trouvé au carnet le 2026-08-19, et le
  remède que `BlocContactsCard` porte déjà — un drapeau, puis un effet. **Aucune temporisation.**
- **Aucune commande éteinte d'avance selon le rôle**, comme au §5.23.
- **UN REFUS SILENCIEUX DOIT ÊTRE DIT, et c'est la règle propre à cette surface.** À la création,
  un refus d'autorisation est un `403` explicite. À la modification, la clause `USING` de la
  politique rend la ligne invisible à l'écriture : le serveur rend « aucune ligne modifiée », sans
  erreur. Le formulaire **reste ouvert**, la saisie est **conservée**, et un message le dit — il
  n'affirme ni le refus ni la disparition, les deux étant indistinguables, et il invite à recharger
  la fiche. **Refermer le formulaire sur un tel silence ferait croire à une modification qui n'a
  pas eu lieu**, et c'est précisément ce que cette règle interdit.
- **La fiche s'actualise sans relire**, et le **titre de la route suit le nouveau nom** — il est une
  donnée (§5.24). La **zone des affaires n'est pas touchée** : aucun champ de ce formulaire n'entre
  dans un rattachement.
- **Aucune commande de suppression**, et l'absence est **assumée** : le cycle de vie d'un contact
  dépend d'un arbitrage ouvert (`docs/SPEC-contacts.md` §6, point 4). Une commande morte serait
  pire que l'absence.

### 5.26 Rattachement d'une affaire depuis la fiche d'un contact — `CRM-060`

Le geste de rattachement de la fiche de contact (`docs/SPEC-contacts.md` §17). Il **hérite du
§5.21** — le bloc des contacts d'une affaire, qui livre le même geste dans l'autre sens — plutôt que
d'inventer une forme : mêmes règles, mêmes vides, même motif. Ce qui suit ne dit que ce qui lui est
propre.

- **Il vit DANS la zone des affaires, sous son titre et au-dessus du tableau**, et non en tête de
  fiche à côté de la commande de modification (§5.25). Un geste se pose près de ce qu'il change :
  « Modifier » touche les caractéristiques et le titre de la route, celui-ci ne touche que la zone
  des affaires. Deux commandes voisines agissant sur des objets différents ne diraient pas laquelle
  fait quoi.

- **Dans le FLUX du document, jamais une modale** (§5.13, §5.21, §5.23, §5.25). Le motif propre à
  cette surface : **le tableau des affaires est ce qui dit à quelles affaires le contact est déjà
  rattaché**, et une modale recouvrirait la réponse à la question que l'on se pose en ouvrant le
  geste.

- **Replié par défaut**, la commande et le formulaire s'**excluent**, et le **retour du focus est
  différé d'un tour de rendu** — les trois règles du §5.25, tenues sans changement et pour le motif
  exact qu'il écrit : la commande est démontée pendant que le formulaire est ouvert. **Aucune
  temporisation.**

- **Le sélecteur n'offre que les affaires non encore rattachées à ce contact** — refus d'une
  commande vouée au `409`, la règle du §5.21 et non une garde de droit. Le refus reste **traduit** :
  deux utilisateurs peuvent agir à la même seconde.

- **UNE AFFAIRE ARCHIVÉE EST OFFERTE, ET SON OPTION LE DIT EN TOUTES LETTRES.** MESURÉ : la base
  **accepte** ce rattachement (§17.3). Le §5.24 a déjà tranché dans le même sens pour la lecture —
  « une affaire archivée est une affaire réelle, et l'historique d'un contact est ce que cette page
  sert ». La mention est un **texte dans le libellé de l'option**, jamais une teinte ni une icône :
  une `option` native n'en porte pas, et le §1 interdit qu'une couleur porte seule une information.
  C'est le seul endroit du produit où l'état d'archivage se dit par un mot au lieu de la pilule du
  §5.6, et l'écart tient à l'élément, pas au style.

- **UNE AFFAIRE À LA CORBEILLE N'EST PAS OFFERTE, ET LA BASE N'Y EST POUR RIEN.** MESURÉ : elle
  **accepte** ce rattachement aussi. Mais la fiche ne liste jamais une affaire à la corbeille
  (§5.24) : le rattachement serait **invisible immédiatement après sa création**, l'utilisateur
  agirait et la liste ne bougerait pas. Une commande dont le résultat est indiscernable d'une panne
  est une commande morte (§5.10).

- **Aucune commande n'est éteinte d'avance selon le rôle** (§5.21, §5.23, §5.25) : la lectrice voit
  le geste, envoie, et reçoit un refus **explicite** — ici un vrai `403`, et non le silence de la
  modification (§5.25). **Aucune mention « sans effet » n'a donc d'objet sur cette surface**, et en
  écrire une décrirait une issue que la base ne produit pas.

- **Un refus n'efface pas la saisie** et le formulaire **reste ouvert** (§5.7 ter).

- **La zone des affaires est relue après un succès, jamais complétée localement** (§5.21) : la
  relecture rapporte l'état d'archivage et l'adresse de l'affaire ajoutée, que le sélecteur ne
  connaissait pas. **La zone des caractéristiques et le titre de la route ne bougent pas** — c'est
  la règle du §5.25 retournée, aucun champ de ce formulaire n'entrant dans les caractéristiques.

- **Les trois vides du §5.21, transposés** : « aucune affaire rattachée » **garde son geste**,
  « toutes les affaires lisibles sont déjà rattachées » n'affiche **aucun sélecteur vide**, et
  « aucune affaire lisible » n'offre **aucune action**.

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : le geste emprunte au §5.21 son icône
  `Link2` et au §5.7 ses contrôles.

### 5.27 Détachement d'une affaire depuis la fiche d'un contact — `CRM-060`

Le geste de détachement de la fiche de contact (`docs/SPEC-contacts.md` §18). Il **hérite du
§5.21** — le même geste dans l'autre sens, sur la fiche de l'affaire — plutôt que d'inventer une
forme. Ce qui suit ne dit que ce qui lui est propre, et l'essentiel de ce qui lui est propre tient
à **l'élément qui le porte** : là-bas une liste plate, ici un **tableau** (§5.9).

- **UNE COMMANDE PAR LIGNE, DANS UNE QUATRIÈME COLONNE.** Le tableau du §5.24 en portait trois —
  affaire, rôle, état ; il en porte quatre. L'en-tête de la colonne des commandes est un
  **libellé lisible**, jamais une cellule vide : un en-tête vide laisse la colonne sans nom pour
  qui navigue au lecteur d'écran (§8).

- **LA CONFIRMATION OCCUPE UNE LIGNE À ELLE, SUR TOUTE LA LARGEUR**, immédiatement sous la ligne
  qu'elle concerne. C'est la règle propre à cette surface, et les deux autres emplacements sont
  écartés pour une raison mesurable :

  - **dans la cellule de la commande** : les cellules du §5.24 sont bornées (`max-w-[32ch]`,
    `truncate`), et une confirmation qui **nomme l'affaire** y serait **tronquée**. La règle du §6
    serait tenue dans le balisage et perdue à l'écran ;
  - **sous le tableau** : rien ne relierait la confirmation à **sa** ligne, sur un tableau qui en
    porte plusieurs. Le §5.21 n'a pas ce problème, sa liste plate imbriquant la confirmation dans
    l'élément de liste.

  La ligne en `colSpan` est le seul emplacement à la fois **dans le flux** (§5.13), **adjacent** à
  la ligne concernée, et **assez large** pour nommer l'objet.

- **LA COMMANDE NE SE CACHE PAS PENDANT SA CONFIRMATION**, à la différence du §5.21 où les deux
  s'excluent dans le même élément. Ici elles vivent sur **deux lignes distinctes** : retirer la
  commande ferait sauter la hauteur de la ligne du dessus au moment précis où l'on demande de lire.
  Elle est **désactivée** tant que sa confirmation est ouverte — il n'y a rien à rouvrir. Ce n'est
  pas une garde de droit, c'est une commande sans objet, au même titre que la commande d'envoi du
  §5.26 sans affaire choisie.

- **UNE SEULE CONFIRMATION À TOUT INSTANT.** Ouvrir celle d'une autre ligne ferme la précédente :
  deux questions destructrices simultanées ne diraient pas à laquelle on répond.

- **LE FOCUS REVIENT À LA COMMANDE DE SA LIGNE, ET CE RETOUR N'EST PAS DIFFÉRÉ.** C'est l'écart
  avec le §5.25 et le §5.26, et il est écrit pour qu'on ne recopie pas un remède sans son motif :
  là-bas la commande est **démontée** pendant que le formulaire est ouvert, et sa référence vaut
  `null` ; ici elle reste montée, seulement désactivée. **Aucune temporisation** (`CLAUDE.md` §18).

- **LA CONFIRMATION NOMME L'AFFAIRE, ET NON LE CONTACT** (§6). C'est le §5.21 **retourné** : là-bas
  le contact variait et l'affaire était le décor ; ici le contact est le décor — on lit sa fiche —
  et l'affaire varie. Elle dit aussi que **le rôle part avec le rattachement** : c'est la seule
  donnée que le geste détruit sans reprise. Bouton d'action **destructif** (§5.3), « Annuler »
  secondaire.

- **TOUTES LES LIGNES PORTENT LA MÊME COMMANDE, Y COMPRIS CELLE D'UNE AFFAIRE ARCHIVÉE.** MESURÉ :
  la base **accepte** ce détachement — `app.can_write_card` dérive du channel et ne lit ni
  `archived_at` ni `deleted_at`. Rien à l'écran ne distingue ces lignes, hors la pilule que le §5.24
  y pose déjà.

- **AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE SELON LE RÔLE** (§5.21, §5.23, §5.25, §5.26, sans
  exception). MESURÉ, et c'est le pendant de la mesure qui a décidé le §5.26 : **la lectrice
  RÉUSSIT** ce détachement sur une affaire et reçoit le silence sur une autre, toutes deux
  lisibles par elle. L'écran qui grisrait « parce que l'utilisateur est lecteur » se **tromperait**.

- **TROIS ISSUES, ET LA TROISIÈME DOIT ÊTRE DITE** — c'est la règle du §5.25, retrouvée ici pour la
  même cause structurelle. Une **suppression** est filtrée par la clause `USING`, qui rend la ligne
  invisible à l'écriture : le serveur rend « aucune ligne retirée », **sans erreur**. L'écran le dit
  — « aucun rattachement n'a été retiré » —, n'affirme **ni** le refus **ni** la disparition, les
  deux étant indistinguables, et **relit**. Faire disparaître la ligne sur ce silence annoncerait un
  détachement qui n'a pas eu lieu.

- **LE MESSAGE DU GESTE SE LIT SOUS LE TABLEAU**, `role="alert"`, jamais en tête d'écran (§5.13,
  §5.16) — la place que le §5.21 lui donne déjà. Il **survit à la relecture**.

- **LA ZONE DES AFFAIRES EST RELUE DANS LES TROIS ISSUES**, jamais amputée localement (§5.21) : un
  retrait optimiste contredirait l'ordre du serveur le temps d'un rendu, et sur l'issue « sans
  effet » il **effacerait une ligne que la base a gardée**. La zone des caractéristiques et le titre
  de la route ne bougent pas (§5.26, règle tenue à l'identique).

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : le geste emprunte au §5.21 son icône
  `Unlink` et sa teinte de danger.

- **LA CONFIRMATION RESTE LISIBLE QUAND LE TABLEAU DÉFILE, ET C'EST UN DÉFAUT TROUVÉ PAR LA
  VÉRIFICATION VISUELLE** (`CLAUDE.md` §16), à 390 px, le 2026-08-19. Le tableau du §5.24 vit dans
  un conteneur `.indique-debordement-x` (§12.6) ; à quatre colonnes, il défile sous 390 px, et
  activer la commande y pousse le défilement vers la droite pour amener le bouton dans le champ. La
  ligne de confirmation, qui appartient au même conteneur, se retrouvait **amputée sur sa gauche** :
  la question nommant l'affaire — précisément ce que le §6 exige de lire **avant** un geste
  destructeur — sortait de l'écran.

  Le bloc de confirmation est donc **épinglé au bord visible du conteneur** (`sticky` à gauche) et
  **borné à la largeur de la fenêtre**. Sur un écran large, la largeur de la cellule est inférieure
  à cette borne, qui ne s'applique pas : le rendu ci-dessus est **inchangé** là où il était déjà
  correct. Ce n'est pas un contournement du débordement — le tableau défile toujours, et c'est son
  contrat —, c'est la reconnaissance que ce bloc porte de la **prose** et non une donnée tabulaire.
  La règle vaut pour **toute** confirmation posée dans une ligne de tableau défilant.

### 5.28 Modification du rôle d'un rattachement, depuis la fiche d'un contact — `CRM-060`

Le geste de correction du rôle sur la fiche de contact (`docs/SPEC-contacts.md` §19). Il **hérite du
§5.27** — le geste voisin, dans la même colonne et sur la même forme de ligne — et du **§5.25**, dont
il reprend le traitement du refus silencieux. Ce qui suit ne dit que ce qui lui est propre.

- **UNE SECONDE COMMANDE DANS LA QUATRIÈME COLONNE, ET L'ORDRE COMPTE : « Modifier le rôle », puis
  « Détacher ».** Le geste qui **corrige** précède le geste qui **retire**, comme la colonne gauche
  de la fiche d'affaire place « Modifier » avant le bloc de corbeille (§5.3, §5.3 ter). Un geste
  destructeur ne se pose jamais en premier sous le pointeur. Icône `PencilLine` — celle de la famille
  « Champs » du fil (§5.11) et de la commande « Modifier » de l'en-tête d'affaire —, taille compacte
  comme sa voisine.

- **LA COLONNE DES COMMANDES NE SE REPLIE PAS, ET C'EST UN DÉFAUT TROUVÉ PAR LA VÉRIFICATION
  VISUELLE** (`CLAUDE.md` §16), à 390 px, le 2026-08-19. Écrites d'abord en `flex-wrap`, les deux
  commandes passaient l'une sous l'autre et la **ligne gagnait de la hauteur** — l'écart que le §5.21
  assume pour sa **liste plate**, et qui ne se transporte pas ici : le §5.9 pose qu'une ligne de
  tableau vaut `--size-target`, et la réponse d'un tableau au manque de place est de **défiler dans
  son conteneur** (§7, §12.6), ce que celui-ci fait déjà. `white-space: nowrap` est posé sur la
  **cellule** et non sur chaque bouton, la propriété étant héritée : sans lui, « Modifier le rôle »
  se coupait en deux lignes **à l'intérieur de son propre bouton**, et la ligne grandissait quand
  même. La règle vaut pour **toute** colonne de commandes d'un tableau.

- **LE FORMULAIRE OCCUPE UNE LIGNE À LUI, comme la confirmation du §5.27**, et pour ses motifs
  exacts — la cellule bornée à `32ch` et tronquée ne peut pas le porter, et sous le tableau rien ne
  le relierait à **sa** ligne. Il est **épinglé au bord visible du conteneur** et borné à la largeur
  de la fenêtre, la règle que le §5.27 a posée pour tout bloc placé dans une ligne de tableau
  défilant.

- **UN SEUL BLOC OUVERT À TOUT INSTANT DANS LE TABLEAU, TOUTES LIGNES ET TOUS GESTES CONFONDUS.** Le
  §5.27 posait « une seule confirmation à la fois » ; la règle s'étend aux **deux** gestes, qui
  vivent désormais sur la même ligne. Ouvrir le formulaire de rôle d'une ligne ferme la confirmation
  de détachement d'une autre, et réciproquement : deux blocs ouverts feraient deux questions dans le
  flux dont rien ne dirait laquelle on répond, et sur un tableau étroit ils se pousseraient l'un
  l'autre hors de vue.

  **Les DEUX commandes d'une ligne sont désactivées tant qu'un bloc de CETTE ligne est ouvert** —
  celles des autres lignes restent actives. Ce n'est pas une garde de droit, c'est une commande sans
  objet, au même titre qu'au §5.27. **Conséquence pratique pour les preuves** : l'exclusivité entre
  les deux gestes ne s'observe **qu'entre deux lignes**, jamais sur une seule — c'est un défaut de
  preuve trouvé en l'exécutant, et non un défaut du produit.

- **LE CHAMP EST PRÉREMPLI du rôle courant** (§5.25) : c'est précisément ce que l'on vient corriger.
  Un rattachement **sans** rôle donne un champ **vide**, jamais le texte « null » — la règle du §5.9
  appliquée à la saisie.

- **LE FORMULAIRE NOMME L'AFFAIRE**, comme la confirmation du §5.27 (§6) : sur cette page le contact
  est le décor et l'affaire varie. Sans ce nom, un formulaire ouvert sous une ligne d'un tableau qui
  défile ne dirait plus quel rattachement il modifie.

- **VIDER LE CHAMP EFFACE LE RÔLE, ET LE TEXTE D'AIDE LE DIT.** MESURÉ : la base accepte `null`. Le
  §6 exige qu'un geste dise ce qu'il fait, et celui-ci retire la seule donnée du rattachement.
  Ce n'est pas une confirmation : la ligne reste, le rattachement reste, et le rôle se réécrit d'un
  second geste identique.

- **LE BOUTON D'ENVOI EST PRIMAIRE, JAMAIS DESTRUCTIF**, et c'est l'écart avec la confirmation
  voisine du §5.27 — écrit pour qu'on ne recopie pas une teinte sans son motif. Corriger un rôle
  n'efface rien qui ne se refasse par le même formulaire, et la teinte de danger est réservée à ce
  qui détruit (§1, §6). **Aucune confirmation** non plus, pour la même raison, et en demander une
  banaliserait celle qui protège le détachement sur la même ligne.

- **Il n'est JAMAIS désactivé par l'état du champ** : un champ vide est un envoi **légitime** — c'est
  l'effacement ci-dessus —, à la différence de la commande d'envoi du §5.26, qui n'a rien à envoyer
  sans affaire choisie. Il l'est pendant le vol, et porte alors son libellé d'attente.

- **Aucune garde de LONGUEUR** — ni `maxLength`, ni compteur de caractères. MESURÉ : la base accepte
  cinq cents caractères et les rend entiers ; en poser une serait une règle de produit que personne
  n'a prise (`CLAUDE.md` §10). La cellule du tableau borne déjà l'**affichage** à `32ch` avec son
  `title` (§5.9), ce qui est une règle de rendu et non de donnée.

- **AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE SELON LE RÔLE** (§5.21, §5.23, §5.25, §5.26, §5.27, sans
  exception). MESURÉ : **la lectrice RÉUSSIT** cette modification sur une affaire et reçoit le
  silence sur une autre, toutes deux lisibles par elle. Une affaire **archivée** porte la commande
  comme les autres, la base l'acceptant.

- **TROIS ISSUES, ET LA TROISIÈME DOIT ÊTRE DITE** — la règle du §5.25 et du §5.27, retrouvée pour la
  même cause structurelle : une **mise à jour** est filtrée par la clause `USING`, qui rend la ligne
  invisible à l'écriture, et le serveur rend « aucun rôle modifié », **sans erreur**.

- **UN REFUS ET UN « SANS EFFET » LAISSENT LE FORMULAIRE OUVERT, ET LA SAISIE EST CONSERVÉE**
  (§5.7 ter, §5.25). **C'est l'écart avec le §5.27**, où la confirmation se ferme dans les trois
  issues : là-bas il n'y a **rien à conserver**, une confirmation ne portant aucune saisie. Le
  message se lit **dans** le formulaire, `role="alert"`, près du champ qui l'a causé (§5.13) — et
  non sous le tableau, où vit celui du détachement, qui doit survivre à une relecture.

- **LA FICHE PREND LA LIGNE RENDUE ET NE RELIT RIEN** (§5.25, règle du §16.7). **Second écart avec le
  §5.27**, et il est mesuré : la relecture de 4h et de 4i existait parce qu'un rattachement **ajouté**
  apporte un archivage et une adresse que le formulaire ignore, et parce qu'une ligne **retirée**
  change l'ensemble. Ici seule une valeur scalaire d'une ligne déjà affichée est réécrite, et le
  serveur la rend : relire serait une seconde requête pour une donnée en main. **Sur un succès, aucun
  message n'est écrit** — la cellule du rôle porte la nouvelle valeur, et elle **est** la
  confirmation (§5.7 ter).

- **Le focus entre dans le champ à l'ouverture, et revient à la commande de RÔLE de sa ligne à la
  fermeture**, sans être différé — la commande n'est jamais démontée, seulement désactivée (§5.27).
  **À celle du rôle, jamais à celle du détachement** : deux gestes vivent sur cette ligne, et rendre
  le focus à l'autre déplacerait l'utilisateur d'un geste à l'autre sans qu'il l'ait demandé.

- **Aucune couleur, aucun jeton nouveau** : le geste emprunte au §5.7 ses contrôles, au §5.5 ses
  variantes, et au §5.11 son icône.

### 5.34 Configuration des comptes entrants — `CRM-088`

Sixième surface de réglages, et la **première de la famille « messagerie » qui écrive** : le §5.14
lit et n'agit pas, celle-ci configure. Ce que l'écran lit, envoie et refuse est spécifié par
`docs/SPEC-mail-subsystem.md` §21 ; les règles ci-dessous ne disent que de quoi il a l'air. Tout ce
que le §5.13 pose vaut ici sans être répété : formulaire **dans le flux du document — aucune
modale**, focus entrant dans le premier champ et rendu à la commande qui l'a ouvert, alerte de refus
**dans le bloc concerné**.

- **UNE `ul` DE LIGNES, ET NON LE TABLEAU DU §5.14, alors que les deux écrans lisent la MÊME
  table.** L'écart est délibéré et il tient à ce que chaque écran montre : le §5.14 compare trois
  colonnes homogènes — boîte, dernière relève, dernier incident — et se balaye en diagonale ; ici
  les valeurs — serveur, port, sécurité, identifiant — **qualifient** la boîte au lieu de se
  comparer d'une ligne à l'autre, et chaque ligne porte **sa propre commande**. C'est exactement la
  distinction que le §5.18 a posée pour le catalogue de nœuds, reprise sans changement, avec les
  hauteurs de ligne et les séparateurs du §5.9.

- **LA CONNEXION SE REND EN DONNÉE TECHNIQUE** (§2) : `serveur:port` et l'identifiant en monospace,
  chiffres tabulaires. Ce sont des identifiants de machine, et les rendre en texte ordinaire les
  ferait lire comme de la prose.

- **LE MODE DE SÉCURITÉ EST UN MOT, jamais une teinte ni une icône seule** (§1) : « SSL »,
  « STARTTLS », « Aucun ». Une pastille verte pour `ssl` et rouge pour `none` porterait un jugement
  que le produit n'a pas à porter — le §13.6 de la spécification établit que `none` est le seul mode
  que la pile locale sait prouver, et qu'il n'est pas une faute en soi.

- **L'ÉTAT DE LA BOÎTE EST UNE PILULE À QUATRE VALEURS, chacune avec son mot** : « En attente »
  (ton neutre), « Connectée » (ton `success`), « En erreur » (ton `danger`), « Désactivée » (ton
  neutre). C'est le composant `Badge` du §5.6, employé tel quel — **avec son point de tête, et non
  une icône propre** : ce point est structurel dans ce composant, qui ne permet pas de le retirer,
  et lui adjoindre une icône ferait porter deux marques à une même information. Un composant métier
  compose les composants du design system, il ne les redéfinit pas (§11). Une cinquième valeur que
  la base rendrait serait un défaut de la contrainte `mail_inbound_accounts_statut`, pas un texte à
  deviner : la pilule est alors **absente**, jamais remplie du code brut — la règle du §5.14 pour un
  code d'incident inconnu.

- **LE MOT DE PASSE N'A NI VALEUR AFFICHÉE, NI POINT DE SUBSTITUTION.** Aucune ligne « ●●●●●● », qui
  affirmerait connaître une longueur que l'écran n'a pas : le champ est **vide**, et son texte d'aide
  du §5.7 dit ce qu'un champ vide fait — il conserve le mot de passe enregistré. C'est la règle du
  §5.9 sur la cellule vide, appliquée à une saisie : on ne rend jamais une donnée qu'on n'a pas.

- **LE SÉLECTEUR DE BOÎTE VISÉE ÉNUMÈRE CE QUE L'APPELANT VOIT, plus ce qu'il peut créer**, et
  l'écran ne calcule aucun droit (§5.3, §5.13, §5.16, §5.21, §5.27, sans exception). Une boîte
  existante y porte son `label`, qui est une **donnée** (§10) ; une boîte à créer porte une clé,
  faute de donnée à afficher. MESURÉ : une lectrice configure **sa** boîte et se voit refuser la
  boîte système ; masquer l'option poserait à l'écran une règle que la base pose déjà, et la masquer
  pour tout le monde priverait l'administratrice du seul chemin vers cette boîte.

- **AUCUNE OPTION VIDE EN TÊTE DE CE SÉLECTEUR**, et c'est l'écart assumé avec le §5.22. Là-bas
  l'option vide est le moyen de **vider** un champ ; ici il n'existe aucune boîte « aucune » — le
  couple `(workspace, owner)` est la clé de l'objet, et n'en choisir aucun n'a pas de sens.

- **LE FORMULAIRE EST REPLIÉ PAR DÉFAUT, et la commande et lui s'EXCLUENT** (§5.23, §5.25) : cette
  surface est d'abord une lecture, et un formulaire toujours déployé pousserait la liste sous la
  ligne de flottaison à chaque visite. Le retour du focus est **différé d'un tour de rendu** — la
  commande est démontée pendant l'ouverture, le remède du §5.25, **aucune temporisation**.

- **UNE SEULE COMMANDE D'ENREGISTREMENT, contrairement au §5.7 ter.** L'écart est écrit pour qu'on
  ne recopie pas un patron sans son motif : la fonction d'écriture prend **six paramètres à la
  fois** et réécrit la ligne entière, si bien qu'un champ qui s'enregistrerait seul renverrait
  quand même les cinq autres — et écraserait ce qu'un collègue vient d'écrire. Le §5.29 a déjà
  tranché dans ce sens pour la fiche d'un bloc d'objectif, en sens inverse et pour la même raison :
  la forme suit ce que la base accepte d'écrire, jamais l'habitude.

- **LE BOUTON D'ENVOI EST PRIMAIRE, JAMAIS DESTRUCTIF** — l'enregistrement n'efface rien qui ne se
  refasse par le même formulaire (§5.28) —, et il n'est **jamais désactivé par l'état des champs** :
  aucune garde de saisie ne double une contrainte de la base (§5.3 ter). Il l'est **pendant le vol**,
  et porte alors son libellé d'attente.

- **LE REFUS SE LIT DANS LE FORMULAIRE, `role="alert"`, sous les champs** (§5.13), et **n'efface pas
  la saisie** (§5.7 ter, §5.25). Il porte une **phrase du produit**, jamais le corps d'erreur du
  serveur : `docs/SPEC-mail-subsystem.md` §21.6 mesure que ce corps contient la référence Vault du
  secret (INC-193), et le §1 du présent document n'a jamais autorisé un écran à recopier une entrée
  qu'il ne maîtrise pas.

- **L'ÉTAT VIDE PORTE LE GESTE** — « Aucune boîte configurée » suivi de la commande —, la règle du
  §5.13 pour l'état vide d'une surface qui agit, déjà tenue par le §5.21, le §5.23 et le §5.29
  tranche 2c. C'est l'écart assumé avec le §5.14, qui n'offre rien parce qu'il n'agit pas.

- **LA LISTE EST BORNÉE À `104ch`, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT UNE CAPTURE**
  (`CLAUDE.md` §16, 2026-08-20). Écrite d'abord à `72ch` — la largeur d'une colonne de prose, celle
  que cette surface aurait eue si elle portait du texte —, la ligne d'une boîte **personnelle** se
  repliait dès 1440 px et sa commande passait seule à la ligne suivante, tandis que celle de la
  boîte système tenait : deux lignes voisines n'avaient plus la même hauteur sans qu'aucune donnée
  ne le justifie. Une ligne porte ici **six** éléments, dont trois données techniques ; sa borne est
  celle de son contenu, pas celle d'un paragraphe. Sous le palier `md`, la ligne se replie et gagne
  de la hauteur — l'écart que le §5.21 assume déjà pour sa liste plate, et pour la même raison.

- **LE TEXTE D'AIDE DU MOT DE PASSE A DEUX VISAGES, et c'est un second défaut trouvé sur la même
  capture.** « Laissé vide, le mot de passe enregistré est conservé » est **faux** sur une boîte qui
  n'existe pas encore : il n'y a rien d'enregistré, et la base refuse par `password_required`. Une
  phrase qui promet une conservation inexistante est la valeur par défaut trompeuse que
  `CLAUDE.md` §18 interdit. La création écrit donc « Obligatoire pour une boîte qui n'existe pas
  encore ». Ce **n'est pas** une garde de saisie : le champ reste envoyable vide, et c'est toujours
  la base qui tranche (§5.3 ter).

- **LA PILULE NEUTRE DISPARAÎT SUR LA LIGNE SURVOLÉE, et c'est une limite OBSERVÉE et acceptée**
  (`CLAUDE.md` §16, capture `docs/captures/CRM-088/comptes-mail-xl-1440.jpg`). Le survol d'une ligne
  emploie `--color-hover`, qui est aussi le fond de la pilule neutre : « En attente » y perd sa
  forme, tout en gardant son point et son mot. C'est exactement ce que le §5.15 a déjà constaté pour
  la pilule « Modifié » — « une pilule neutre n'existe que par contraste avec ce qui la porte ». Le
  §1 reste tenu : l'information est portée par le **mot**, jamais par la forme ni par la teinte, et
  aucun autre état n'est concerné, les trois autres portant une couleur.

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : l'écran emprunte au §5.18 sa liste plate,
  au §5.6 ses pilules, au §5.7 ses champs, au §5.5 ses variantes et au §5.14 son vocabulaire d'état.

### 5.35 Configuration des identités sortantes — `CRM-089`

Septième surface de réglages, et la **jumelle** du §5.34 : celle-là configure ce qu'on reçoit,
celle-ci ce qu'on expédie. `docs/SPEC-mail-subsystem.md` §22 dit ce que l'écran lit, envoie et
refuse ; les règles ci-dessous ne disent que de quoi il a l'air. **Tout ce que le §5.34 pose vaut
ici sans être répété** — `ul` de lignes et non tableau, connexion en donnée technique, mode de
sécurité en toutes lettres, pilule d'état à quatre valeurs, mot de passe sans point de substitution,
sélecteur jamais restreint selon le rôle, formulaire replié dans le flux, commande d'enregistrement
unique et jamais désactivée par l'état des champs, refus `role="alert"` sous les champs, état vide
porteur du geste. Seuls les **écarts** sont écrits ci-dessous, et chacun a sa cause.

- **LA LIGNE PORTE L'ADRESSE D'EXPÉDITION EN TÊTE, avant le libellé.** C'est la seule donnée de
  cette table qu'un destinataire verra (`docs/SPEC-mail-subsystem.md` §14.2), et c'est elle qui
  distingue deux identités d'une même personne — le libellé, lui, peut être identique. Le §5.34
  plaçait le libellé en tête parce qu'une personne n'a qu'**une** boîte entrante ; ici la clé est un
  triplet, et la tête de ligne suit la clé.

- **LE NOM D'EXPÉDITEUR SE REND AVEC L'ADRESSE, dans la forme `Nom <adresse>`**, et jamais sur deux
  colonnes séparées : c'est ainsi qu'un destinataire le lira. Absent, seule l'adresse est rendue —
  la règle de la cellule vide du §5.9, jamais un tiret ni une valeur inventée.

- **L'IDENTITÉ PAR DÉFAUT PORTE UNE PILULE `success` « Par défaut »**, et les autres n'en portent
  aucune. Une pilule neutre « Secondaire » sur chaque autre ligne remplirait la liste d'une
  information que son absence dit déjà, et le §1 réserve la couleur à ce qui la mérite : ici, une
  seule ligne par personne la porte, et c'est exactement ce que l'index unique partiel garantit.

- **DEUX PILULES PEUVENT COHABITER SUR UNE LIGNE** — « Par défaut » et l'état de la connexion —, et
  c'est le seul écran de réglages où cela arrive. Elles ne disent pas la même chose : l'une est un
  **choix** de l'utilisateur, l'autre un **constat** du service. L'ordre les sépare — le choix suit
  l'identité, le constat ferme la ligne, juste avant la commande —, et aucune ne change de forme
  selon l'autre.

- **LA CASE « IDENTITÉ PAR DÉFAUT » EST UNE CASE À COCHER, ET ELLE EST COCHÉE SUR UNE
  DÉCLARATION.** C'est le défaut de la fonction d'écriture, pas une préférence d'écran
  (`coalesce(p_is_default, true)`), et montrer autre chose ferait mentir le formulaire sur ce que
  l'enregistrement va faire. **Aucune confirmation ne précède le déplacement du défaut** : la base
  rabat l'ancienne identité sans état intermédiaire (§14.2), le geste est réversible par le même
  formulaire, et le §5.28 réserve la confirmation à ce qui ne se refait pas.

- **LE CHAMP « ADRESSE D'EXPÉDITION » PORTE UN TEXTE D'AIDE SUR UNE IDENTITÉ EXISTANTE, ET LUI
  SEUL.** Il dit que changer l'adresse **déclare une seconde identité** au lieu de renommer celle-ci
  — comportement mesuré de la base (`docs/SPEC-mail-subsystem.md` §22.4). Ce n'est **pas** une garde
  de saisie : le champ reste modifiable, rien n'est désactivé, et la liste relue montre les deux
  lignes. C'est la même discipline que les deux textes d'aide du mot de passe au §5.34 — l'écran
  explique ce que la base fera, il ne l'empêche pas.

- **LE CHAMP « SIGNATURE » EST UNE ZONE DE TEXTE MULTILIGNE, ET IL SUIT LE NOM D'EXPÉDITEUR**
  — l'ordre du message : d'abord qui écrit, ensuite ce qui ferme (`CRM-063`,
  `docs/SPEC-modeles-emails.md` §10.6). Quatre lignes visibles, jamais une seule ligne : une
  signature EST une mise en forme, et un champ d'une ligne ferait croire le contraire. **Ni
  `required`, ni `maxLength`** — la borne de deux mille caractères vit en base et c'est elle qui
  refuse, comme pour tous les champs de cet écran (§5.3 ter). Il porte **un texte d'aide**, sur le
  patron de ceux du mot de passe au §5.34 : il dit ce que la base FERA — la signature est ajoutée à
  la fin de chaque message expédié depuis cette identité, et vider le champ la supprime —, il
  n'empêche rien.

- **LA LISTE NE REND PAS LA SIGNATURE, SEULEMENT SA PRÉSENCE**, par une pilule **neutre**
  « Signature ». Deux mille caractères dans une `ul` de lignes détruiraient la densité que cette
  surface tient ; sa présence, elle, est une information de liste. La pilule est **neutre** et non
  colorée parce qu'elle n'est ni un choix comme « Par défaut », ni un constat du service comme
  l'état de connexion : c'est un fait de configuration, et le §1 réserve la couleur à ce qui la
  mérite. **Une TROISIÈME pilule peut donc cohabiter sur une ligne**, et l'ordre reste celui du
  sens : le choix, puis la configuration, puis le constat qui ferme la ligne. La pilule ne s'allume
  que sur une signature **réelle** — une signature entièrement blanche n'en allume aucune, la garde
  rendant alors le corps inchangé : l'écran dit exactement ce que la base fera.

- **LE SÉLECTEUR NOMME UNE IDENTITÉ PAR SON LIBELLÉ SUIVI DE SON ADRESSE**, et non par son seul
  libellé comme au §5.34. Deux identités d'une même personne peuvent porter le même libellé ; les
  distinguer par la donnée qui est leur clé vaut mieux que d'ajouter un rang ou un identifiant, que
  personne ne lit.

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : l'écran emprunte au §5.34 sa forme
  entière, au §5.18 sa liste plate, au §5.6 ses pilules et au §5.7 ses champs.

### 5.36 Ma journée — `CRM-061`

Deuxième surface **de travail** transverse du produit, après le carnet (§5.19), et la première dont
le rangement est le **temps**. Ce que l'écran lit, découpe et refuse de deviner est spécifié par
`docs/SPEC-cards.md` §17 ; les règles ci-dessous ne disent que de quoi il a l'air.

- **TROIS SECTIONS, ET NON UN TABLEAU DE PLUS.** Le §5.9 régit des colonnes comparables que l'œil
  balaye en diagonale ; ici la question n'est pas « laquelle est la plus grosse » mais « qu'est-ce
  qui est en retard ». Le patron est donc une `section` par groupe, chacune portant son `h2` et sa
  `ul` de lignes — la liste plate du §5.18, avec les hauteurs de ligne et les séparateurs du §5.9 :
  `--size-target`, bordure basse `--color-border`, survol `--color-hover`, aucune zébrure.

- **LE COMPTE VIT DANS LE TITRE DE SA SECTION, EN TOUTES LETTRES** — « En retard (3) » —, dans son
  **propre élément** et jamais comme un nœud de texte accolé au libellé : c'est le défaut
  « Discussion1 » du §5.11, dont le remède est écrit une fois pour tout le produit. Un badge nu
  serait pire encore : un chiffre ne dit pas ce qu'il compte.

- **UNE SECTION VIDE N'EST PAS RENDUE.** C'est l'écart assumé avec le §5.8, et son motif est celui
  du §5.11 pour la barre de filtres du fil : trois titres surmontant trois vides diraient trois fois
  « rien » là où leur absence le dit une fois. Le cas où **tout** est vide est traité par les deux
  états vides ci-dessous, qui, eux, sont explicites et nommés.

- **« EN RETARD » PORTE LA TEINTE DE DANGER, ET ELLE PORTE SUR L'ÉCHÉANCE, PAS SUR LA LIGNE.**
  `--color-danger-on-soft` sur `--color-danger-soft`, sur la seule donnée qui est en cause — c'est
  la pastille d'ancienneté d'une card (§5.1) et l'ancienneté de la table de saisie (§5.31), même
  signal, même forme. Teinter la ligne entière ferait d'une affaire en retard une **erreur**, ce
  qu'elle n'est pas : c'est un travail à faire. Le §1 est tenu par le titre de la section, qui écrit
  « En retard » en toutes lettres.

- **L'ÉCHÉANCE EST EN TÊTE DE LIGNE, ET C'EST UNE DONNÉE TECHNIQUE** (§2) : monospace, chiffres
  tabulaires. Elle vient **avant** le titre de l'affaire, contrairement à toutes les autres listes
  du produit — parce que c'est elle qui range cet écran, et qu'une colonne de dates alignées se lit
  d'un regard là où des dates en fin de ligne se cherchent. **L'heure est rendue avec la date** :
  une échéance du jour sans heure ne dirait pas si la matinée est déjà passée.

- **LA PILULE « Track › Channel » EST CELLE DU §5.29**, réemployée sans copie — c'est la même
  donnée, elle doit se reconnaître d'un écran à l'autre. Elle ferme la ligne, après la prochaine
  action : elle situe l'affaire, elle ne la nomme pas.

- **LA PORTÉE EST UNE PAIRE DE LIENS, PAS UNE CASE À COCHER.** « Mes affaires » et « Tout l'espace
  de travail » changent d'**adresse** (`docs/SPEC-cards.md` §17.2), et le §12.1 a déjà tranché que
  ce qui change d'adresse est un lien : en faire un contrôle de formulaire retirerait le clic du
  milieu, le nouvel onglet et la copie de l'adresse. `aria-current="page"` porte l'état, et une
  bordure basse de même épaisseur dans les deux états empêche le texte de se décaler — le patron
  exact de la barre d'onglets.

  *C'est l'écart avec la bascule de sommeil du §5.3 quinquies, qui est une case à cocher.*

  > **CORRIGÉ LE 2026-08-29 — `CRM-081` tranche 3, et le motif écrit ici était FAUX.** Cette phrase
  > disait « celle-là ne change pas d'adresse dans le board, celle-ci en change ». La bascule de
  > sommeil **change l'adresse** dans le board et dans la vue liste depuis la tranche 2 b du
  > 2026-08-17 (`docs/SPEC-cards.md` §16.12.4), et dans l'inbox depuis la tranche 3 (§16.17.1) : les
  > trois écrans écrivent `?sommeil=visibles`. Un motif faux est plus coûteux qu'un motif absent —
  > il enseigne une distinction qui n'existe pas, et la prochaine surface qui devra choisir entre
  > une case et deux liens s'y fiera.
  >
  > **LE VRAI CRITÈRE, ET IL DÉCIDE LES DEUX CAS SANS EXCEPTION : est-ce un CHOIX ENTRE DEUX VUES,
  > ou un RAFFINEMENT BINAIRE de la vue courante ?** « Mes affaires » et « Tout l'espace de
  > travail » sont deux vues nommées, également légitimes, dont chacune est une destination : deux
  > liens, et le §12.1 s'applique. « Afficher les affaires en sommeil » n'est pas une seconde vue,
  > c'est une option de celle qu'on regarde — une case la rend, et son état « coché / décoché »
  > s'annonce nativement là où deux liens obligeraient à nommer deux vues que le produit n'a pas.
  > **Que l'adresse porte l'un et l'autre ne les distingue pas** : elle porte le tri et la
  > pagination de la vue liste sans en faire des liens non plus (§12.2 de `docs/SPEC-cards.md`).

- **ELLE RESTE RENDUE SUR UN ÉCRAN VIDE**, comme la barre de filtres du §5.3 quinquies et les
  onglets du §5.31 : elle est la cause possible de ce vide, et la masquer priverait l'utilisateur du
  seul geste qui l'en sort.

- **DEUX VIDES DISTINCTS, ET AUCUN NE SE CONFOND AVEC L'AUTRE** (§5.11, §5.32). « Aucune échéance
  dans votre journée » **porte l'action** qui élargit la portée — le patron du §5.8 ; « aucune
  échéance dans les sept prochains jours » n'en porte **aucune**, il n'y a rien à élargir et un
  bouton y serait un chemin vers nulle part (§5.16, §5.19).

- **AUCUNE COMMANDE D'ÉCRITURE, ET L'ABSENCE EST ASSUMÉE.** Ni report, ni « fait », ni saisie : le
  seul chemin d'écriture de ces deux colonnes est l'en-tête de la fiche (§5.3 ter). Une commande
  morte serait pire que l'absence (§5.25).

- **SOUS LE PALIER `md`, LA LIGNE SE REPLIE ET GAGNE DE LA HAUTEUR** — l'écart que le §5.21 assume
  déjà pour sa liste plate, et pris ici pour la même raison : quatre éléments ne tiennent pas sur
  390 px, et la réponse d'une liste plate au manque de place est de se replier, non de tronquer une
  donnée. `md` et jamais `sm`, qui est un variant inconnu que Tailwind supprime en silence (§11,
  §5.20). La page ne défile jamais horizontalement (§7).

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : l'écran emprunte au §5.18 sa liste plate,
  au §5.29 sa pilule de channel, au §12.1 son patron de liens, au §5.1 sa teinte de retard et au
  §5.8 ses états. Son entrée de barre latérale porte `CalendarCheck`, déjà déclarée par `CRM-007`.

### 5.37 Affaires figées — `CRM-062`

Troisième surface **de travail** transverse du produit, après le carnet (§5.19) et « Ma journée »
(§5.36), et la première dont le rangement est le **retard**. Ce que l'écran lit, groupe et refuse
de deviner est spécifié par `docs/SPEC-relances.md` §10 ; les règles ci-dessous ne disent que de
quoi il a l'air. Tout ce que le §5.36 pose vaut ici sans être répété : liste plate du §5.18 avec les
hauteurs de ligne et les séparateurs du §5.9, compte dans son propre élément, pilule de channel du
§5.29 réemployée entière.

- **UN GROUPE PAR DOSSIER, ET NON PAR TRACK.** Le dossier est là où l'affaire vit, c'est lui que la
  pilule « Track › Channel » nomme, et c'est le grain auquel on va agir. Un regroupement par track
  fondrait deux dossiers distincts d'un même track — cas que le jeu de démonstration exerce
  réellement, `studio-web` portant `refonte` **et** `maintenance`. C'est l'écart avec les trois
  sections FIXES du §5.36 : là-bas les groupes sont connus d'avance et se nomment « En retard »,
  « Aujourd'hui », « À venir » ; ici ils sont une **donnée**, et leur nombre varie.

- **L'ORDRE DES GROUPES EST CELUI DE LEUR PREMIÈRE LIGNE**, donc du plus gros retard. Un ordre
  alphabétique de dossier ferait descendre en bas d'écran celui qui est le plus en retard, ce qui
  est exactement l'information que l'écran existe pour donner. L'ordre **à l'intérieur** d'un groupe
  est celui du serveur, conservé tel quel.

- **UN GROUPE VIDE N'EXISTE PAS**, contrairement au §5.36 qui doit dire pourquoi il ne rend pas une
  section vide : un groupe naît d'au moins une ligne, et il n'y a donc rien à écrire sur l'absence.

- **LE RETARD EST EN TÊTE DE LIGNE, ET C'EST UNE DONNÉE TECHNIQUE** (§2) : monospace, chiffres
  tabulaires. Il vient **avant** le titre, pour la raison exacte qui met l'échéance en tête au
  §5.36 — c'est lui qui range cet écran, et une colonne de nombres alignés se lit d'un regard.
  **L'unité « j » occupe son propre élément**, jamais un nœud de texte accolé au nombre : c'est le
  défaut « Discussion1 » du §5.11, dont le remède est écrit une fois pour tout le produit.

- **LA TEINTE DE DANGER PORTE SUR LE RETARD, PAS SUR LA LIGNE.** `--color-danger-on-soft` sur
  `--color-danger-soft`, sur la seule donnée qui est en cause — c'est la pastille d'ancienneté d'une
  card (§5.1), l'ancienneté de la table de saisie (§5.31) et le retard de « Ma journée » (§5.36) :
  même signal, même forme. Teinter la ligne entière ferait d'une affaire figée une **erreur**, ce
  qu'elle n'est pas : c'est un travail à faire. Le §1 est tenu par le titre de l'écran et par
  l'unité, écrits en toutes lettres.

- **UN RETARD DE ZÉRO SE REND « 0 j », ET CE N'EST PAS UNE CELLULE VIDE.** La borne de la règle est
  LARGE (`docs/SPEC-relances.md` §2.5) : une affaire atteinte exactement sur son seuil est figée.
  C'est une donnée, pas une absence, et la règle du §5.9 ne s'applique donc pas.

- **LE SEUIL ACCOMPAGNE LE RETARD**, en 13 px `--color-text-2` — « seuil 14 j ». Il n'est pas
  décoratif : un retard sans son seuil n'a pas d'échelle, exactement la raison pour laquelle le
  `payload` d'une relance porte les deux nombres et non un seul (§9.6 de la spécification).

- **L'ÉTAPE EST UNE PILULE NEUTRE** `--color-hover` / `--color-text-2`, `rounded-full` (§5.6) : c'est
  le dossier interne de l'affaire, pas son identité, et une teinte de donnée lui ferait porter une
  urgence qu'elle n'a pas. Une étape que la seconde lecture n'a pas rapportée ne rend **rien** — ni
  tiret, ni « non renseigné » (§5.9).

- **UNE AFFAIRE QUE LA SECONDE LECTURE N'A PAS RAPPORTÉE RESTE LISTÉE**, sans lien, sans étape et
  sans pilule. Elle garde son titre, son retard et son seuil, que la règle rend déjà. La masquer
  retrancherait une affaire en retard de la liste qui existe pour les montrer ; lui donner un lien
  vers une adresse incomplète mènerait à un écran que l'utilisateur croirait cassé (§5.32). Le cas
  n'est pas théorique — les deux lectures de l'écran ne sont pas atomiques.

- **AUCUNE BASCULE DE PORTÉE**, contrairement au §5.36. Ce n'est pas un oubli : `cards_figees()` ne
  prend **aucun argument** et rend « ce que l'appelant peut lire », sans autre dimension. Poser un
  filtre « mes affaires » à l'écran ferait de l'interface le juge d'un rangement que la base ne
  connaît pas (`CLAUDE.md` §10), et l'écart est **nommé** au §10.6 de la spécification plutôt que
  comblé au passage.

- **UN SEUL ÉTAT VIDE, ET IL N'OFFRE AUCUNE ACTION.** C'est l'écart au §5.8 que la corbeille (§5.16)
  et le carnet (§5.19) prennent déjà : il n'y a rien à faire d'une liste d'affaires en retard qui
  est vide, et un bouton y serait un chemin vers nulle part. **Le message dit que l'état est SAIN**,
  pas qu'il manque quelque chose — « aucune affaire ne dort dans son étape » est une bonne nouvelle.
  Un seul et non deux comme au §5.36 : il n'y a aucune portée à élargir, donc rien ne distingue
  « rien pour moi » de « rien pour personne ».

- **L'ÉCHEC DE LA RÈGLE EST UNE ERREUR AVEC REPRISE, JAMAIS L'ÉTAT VIDE.** Rendre « aucune affaire
  ne dort » sur une panne ferait passer un défaut pour une bonne nouvelle — la simulation de succès
  que `CLAUDE.md` §18 interdit. L'échec de la **seconde** lecture, lui, ne remplace rien : la liste
  reste, dégradée, comme une affaire absente de cette lecture.

- **L'ÉCRAN NE NOMME JAMAIS CE QU'IL NE MONTRE PAS.** Aucune phrase ne dit « une affaire vous est
  masquée » : c'est la règle que le cumul des coûts (§5.33) et le canevas d'objectifs (§5.29)
  tiennent déjà, et elle est ici **mesurée** — la lectrice du jeu de démonstration lit trois des
  quatre affaires figées, et rien à l'écran ne trahit la quatrième.

- **AUCUNE COMMANDE D'ÉCRITURE, ET L'ABSENCE EST ASSUMÉE.** Ni report, ni « traité », ni mise en
  sommeil : le seul chemin d'écriture est la fiche de l'affaire (§5.3 ter, §5.3 quater), et un
  second geste ici en ferait une seconde définition du même geste. C'est la règle du §5.36, tenue
  sans changement.

- **SOUS LE PALIER `md`, LA LIGNE SE REPLIE ET GAGNE DE LA HAUTEUR** — l'écart que le §5.21 assume
  pour sa liste plate et que le §5.36 reprend : cinq éléments ne tiennent pas sur 390 px, et la
  réponse d'une liste plate au manque de place est de se replier, non de tronquer une donnée. Le
  **titre prend sa propre ligne** (`basis-full`), ce qui rend le repli régulier là où `grow` seul le
  faisait varier d'une ligne à l'autre — défaut déjà mesuré au §5.36. `md` et jamais `sm`, qui est
  un variant inconnu que Tailwind supprime en silence (§11, §5.20). **Mesuré aux quatre paliers : la
  page ne défile jamais horizontalement** (§7).

- **L'ENTRÉE DE BARRE LATÉRALE PORTE `Hourglass`, ET ELLE SUIT IMMÉDIATEMENT « Ma journée ».** Les
  deux écrans répondent à la même question — « qu'est-ce qui me réclame ? » — et se lisent dans cet
  ordre : ce qui est **dû** aujourd'hui, puis ce qui **dort** depuis trop longtemps. Ce n'est pas
  une commodité de rangement : une échéance dépassée et une affaire figée sont deux notions
  différentes qui se recoupent souvent, et la navigation est le seul endroit où cette différence
  s'enseigne. L'icône dit le temps qui s'écoule sans que rien n'avance ; aucune autre entrée ne la
  porte (§9).

- **Aucune couleur, aucun jeton nouveau** : l'écran emprunte au §5.18 sa liste plate, au §5.29 sa
  pilule de channel, au §5.6 sa pilule neutre, au §5.1 sa teinte de retard et au §5.8 ses états.

### 5.38 La relance automatique dans le fil — `CRM-062`

Quatorzième type d'événement de la timeline unifiée (§5.11), et **le seul que la teinte de danger
qualifie**. Ce qu'il est et ce qu'il porte est spécifié par `docs/SPEC-relances.md` §10.3.1.

- **Pastille `--color-danger-soft`, icône `--color-danger`, icône Lucide `AlarmClock`.** C'est le
  même signal que l'ancienneté dépassée du §5.1 et que le retard du §5.37 : il doit avoir la même
  forme d'un écran à l'autre. Aucun autre type du fil ne porte `AlarmClock`, et le §9 interdit
  qu'une icône serve deux objets distincts. Elle est **distincte de l'`Hourglass`** de l'entrée de
  navigation du §5.37 : l'écran montre un **état**, cette ligne date un **geste**.

- **Famille « Cycle de vie »**, avec les six autres : « qu'est devenue cette affaire ? » — elle a
  stagné. **Aucune sixième bascule de filtre** n'est ajoutée pour un type, arbitrage que `CRM-081` a
  déjà rendu pour les deux gestes du sommeil (§5.11).

- **Le libellé nomme le FAIT, pas la mécanique** : « Relance automatique », jamais « Affaire figée »
  — le second décrirait un état, or la ligne du fil date un geste. Le mot `stalled` est le
  vocabulaire de la base, et il n'atteint jamais l'écran (§10).

- **Le détail dit le retard AVEC son seuil**, et il est **composé par une clé de traduction, jamais
  par concaténation** (§10). L'accord est posé — « 1 jour » n'est pas « 1 jours » —, et un retard de
  **zéro** se dit autrement : « atteint son seuil de 14 jours », parce que « 0 jours de retard » se
  lirait comme une erreur de calcul.

- **Un `payload` amputé ne rend AUCUN détail**, et surtout pas un `undefined` : la ligne retombe sur
  son seul libellé, exactement comme un libellé d'étape non résolu (§5.11).

- **L'acteur reste muet.** Une relance n'a pas d'auteur humain, et le fil ne nomme jamais un acteur
  nul (§5.11) : lui en inventer un serait la valeur par défaut trompeuse que `CLAUDE.md` §18
  proscrit.

- **Aucune couleur, aucun jeton nouveau** : la ligne emprunte au §5.11 sa forme et au §1 sa teinte.

### 5.39 Modèles d'emails — `CRM-063`

**Huitième surface de réglages**, et la troisième de la famille « messagerie » qui écrive, après le
§5.34 — ce qu'on reçoit — et le §5.35 — ce qu'on expédie. Celle-ci porte le **texte** qui sera
expédié. `docs/SPEC-modeles-emails.md` §9 dit ce que l'écran lit, envoie et refuse ; les règles
ci-dessous ne disent que de quoi il a l'air.

**Tout ce que le §5.34 pose vaut ici sans être répété** : `ul` de lignes plates et non tableau,
formulaire replié **dans le flux du document — aucune modale**, focus entrant dans le premier champ
et rendu à la commande qui l'a ouvert, commande d'enregistrement unique et **jamais désactivée par
l'état des champs**, refus `role="alert"` sous les champs qui **n'efface pas la saisie**, état vide
porteur du geste, sélecteur jamais restreint selon le rôle, borne de liste à `104ch`. Seuls les
**écarts** sont écrits ci-dessous, et chacun a sa cause.

- **LE NOM EST EN TÊTE DE LIGNE, ET C'EST LA CLÉ.** `mail_templates_workspace_name_key` rend le nom
  unique par workspace sur sa forme normalisée : la tête de ligne suit la clé, comme au §5.35, à
  ceci près que la clé n'a ici qu'un seul champ.

- **L'OBJET SUIT, EN SECOND TON, ET SES VARIABLES SE RENDENT TELLES QUELLES.** Un objet portant
  `{{card.title}}` s'affiche avec ses accolades : **la liste n'est pas une prévisualisation**, et
  substituer y supposerait une affaire que la liste n'a pas. C'est la même discipline qu'au §5.9 —
  on ne rend jamais une donnée qu'on n'a pas.

- **AUCUNE PILULE, AUCUNE COULEUR, AUCUN COMPTE.** Un modèle n'a pas d'état : la table ne porte ni
  statut ni `archived_at`, et c'est le seul écran de réglages dont les lignes n'en portent aucune.
  Un compte de variables serait un chiffre qui ne dit pas ce qu'il compte — le défaut que le §5.36
  a déjà refusé pour ses sections.

- **LA SUPPRESSION N'EST PAS SUR LA LIGNE, elle vit dans la fiche** — patron du §5.29. Un geste
  destructeur ne se déclenche pas depuis une liste qu'on balaye, et la fiche est le seul endroit où
  le rédacteur a sous les yeux le texte qu'il va perdre.

- **LA CONFIRMATION NOMME LE MODÈLE ET N'ANNONCE AUCUNE CASCADE**, et c'est une **mesure** : rien,
  dans la base au 2026-08-25, ne référence un modèle. Annoncer une rupture de séquence décrirait un
  objet que la tranche 4 n'a pas posé, et promettre le refus de son futur `on delete restrict`
  mentirait dans l'autre sens. La confirmation dit ce qui est vrai : le nom, et que le texte est
  définitivement perdu.

- **LA PALETTE DES VARIABLES EST UNE LISTE DE BOUTONS, chacun portant un nom en DONNÉE TECHNIQUE**
  (§2), sous le champ du corps. Le bouton **insère** `{{nom}}` à la position du curseur du dernier
  champ visité — l'objet ou le corps —, **et le corps à défaut**. Ce n'est **pas** une garde de
  saisie (§5.3 ter) : les deux champs restent librement saisissables, et c'est la contrainte de la
  base qui refuse une variable inconnue, refus **traduit**. La liste vient de la base et n'est
  **jamais recopiée dans l'écran** : une treizième variable y paraîtrait sans qu'on touche à
  l'interface.

- **LA PRÉVISUALISATION NE PRÉSÉLECTIONNE RIEN.** Ses trois sélecteurs — affaire, contact, identité
  — ouvrent tous sur une **option vide**, y compris celui de l'affaire, qui est pourtant
  obligatoire. C'est l'écart assumé avec le §5.34, dont le sélecteur n'a aucune option vide : là-bas
  la cible est la clé de l'objet configuré, ici c'est un **choix de simulation** que personne n'a
  encore fait, et présélectionner la première affaire du tri ferait rendre un texte au sujet d'une
  affaire que le rédacteur n'a pas désignée.

- **LE RENDU EST UN GESTE EXPLICITE, jamais un effet de frappe** : la fonction lit six tables sous
  RLS, et rendre à chaque changement de sélecteur ferait trois appels pour un seul choix. Le bouton
  porte son libellé d'attente pendant le vol.

- **LE CORPS PRÉVISUALISÉ PRÉSERVE SES RETOURS À LA LIGNE** (`white-space: pre-wrap`) : le
  sous-système expédie du **texte**, et un corps reflué mentirait sur ce qui partira.

- **LE BLOC DES VARIABLES SANS VALEUR EST UN `role="status"`, JAMAIS UN `role="alert"`.** La
  prévisualisation a **réussi** ; employer le rôle du refus ferait lire une panne là où il y a une
  information. Son compte est **en toutes lettres et dans son propre élément** — « 3 variables sans
  valeur » —, jamais un badge nu ni un nœud de texte accolé, qui est le défaut « Discussion1 » du
  §5.11, et **l'accord se fait par clé** (§10). Chaque nom y est rendu en **donnée technique**, dans
  la graphie exacte que le rédacteur a tapée : c'est la chaîne qu'il ira chercher dans son texte.

- **UNE LISTE DE VARIABLES VIDE NE REND RIEN.** Aucun « aucune variable manquante », aucune pilule
  verte : l'absence dit déjà ce qu'un message répéterait (§5.9), et le §1 réserve la couleur à ce
  qui la mérite.

- **UN RENDU À ZÉRO LIGNE N'EST PAS UNE ERREUR, ET SE DIT EN UNE SEULE PHRASE** — « choisissez une
  affaire, ou l'affaire choisie n'est plus lisible ». Les deux causes sont **volontairement
  confondues**, parce que la fonction les confond elle-même : une phrase qui les distinguerait
  divulguerait ce que le zéro-ligne cache.

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : l'écran emprunte au §5.34 sa forme
  entière, au §5.18 sa liste plate, au §5.7 ses champs, au §5.5 ses variantes et au §5.29 son patron
  de suppression confirmée.

### 5.40 Suppression d'un contact, depuis sa fiche — `CRM-060`

Le dernier geste du cycle de vie d'un contact (`docs/SPEC-contacts.md` §20). Il **hérite du §5.25** —
la commande posée dans la zone de commandes de la fiche, avant les deux zones — et du **§5.27** pour
tout ce qui touche à une confirmation destructive. Ce qui suit ne dit que ce qui lui est propre.

- **DEUX COMMANDES DANS LA ZONE DE COMMANDES, ET ELLES NE S'EXCLUENT PAS.** Le §5.24 posait qu'une
  commande — « Modifier » — vivait avant les deux zones ; il y en a désormais **deux**, « Modifier »
  puis « Supprimer ». Ce sont deux gestes sur le **même objet**, non deux états d'un même geste :
  masquer l'une pendant l'autre ferait sauter la hauteur de la zone à chaque ouverture.

- **LA COMMANDE DESTRUCTIVE VIENT EN SECOND**, jamais en premier : l'ordre de lecture met le geste
  réparable avant le geste irréversible, comme le §5.16 place « Restaurer » avant « Supprimer
  définitivement ». Icône `Trash2`, teinte de danger (§5.3).

- **LA CONFIRMATION VIT DANS LE FLUX, SOUS LES DEUX COMMANDES** (§5.13) — jamais en modale, et
  **jamais dans une ligne de tableau** : la règle du `colSpan` posée au §5.27 vaut pour une
  confirmation qui porte sur **une ligne**, et ce geste n'en vise aucune. Recopier ce remède sans son
  motif poserait une confirmation dans un tableau qui n'est pas son sujet.

- **UNE SEULE QUESTION OUVERTE À TOUT INSTANT SUR CETTE FICHE.** Ouvrir la confirmation **referme**
  le formulaire de modification, et réciproquement. C'est la règle du §5.28 — « un seul bloc ouvert »
  — étendue à deux gestes qui ne partagent pas leur forme : deux questions simultanées sur le même
  objet ne diraient pas à laquelle on répond.

- **LA COMMANDE RESTE MONTÉE ET DEVIENT DÉSACTIVÉE** pendant que sa confirmation est ouverte, comme
  au §5.27 et pour la même cause : sa référence reste valide, **le retour du focus n'a donc pas à
  être différé**, et aucune temporisation n'est écrite (`CLAUDE.md` §18). C'est l'écart avec le
  §5.25, où la commande est démontée.

- **LA CONFIRMATION NOMME LE CONTACT ET ÉNONCE SES DEUX CONSÉQUENCES**, et c'est la règle propre à
  cette surface :

  1. **ce que le geste emporte** — le nombre d'affaires auxquelles le contact est rattaché, et le
     fait que **chacune gardera dans son historique la trace de son détachement**. MESURÉ : la
     suppression cascade sur `card_contacts` et le trigger de la migration `0061` écrit
     `contact_unlinked` dans chaque fil. C'est la seule conséquence que l'utilisateur ne peut **pas**
     lire sur l'écran qu'il regarde ;
  2. **ce que le geste NE détruit PAS** — les valeurs de formulaire qui désignent ce contact
     **demeurent** (décision 516). Propriété rassurante et contre-intuitive : la taire laisserait
     croire à une purge.

  Le nombre d'affaires vient de la **donnée déjà lue** (§5.24, zone 2), jamais d'une requête de plus.
  **À zéro, la phrase des rattachements n'est pas rendue** — annoncer « 0 affaire » ferait lire une
  conséquence inexistante.

- **TROIS ISSUES, ET DEUX SEULEMENT RESTENT SUR L'ÉCRAN.** Le succès **quitte la fiche pour le
  carnet** (§5.19) : la fiche d'un contact supprimé n'a plus de sujet, et la relire rendrait l'écran
  « contact introuvable » du §5.24 — un geste réussi se solderait par un écran d'échec. Les deux
  autres issues **restent**, relisent la fiche, et affichent leur message à la place de la
  confirmation, `role="alert"`, jamais en tête d'écran (§5.13, §5.16).

- **L'ISSUE « SANS EFFET » DOIT ÊTRE DITE**, comme au §5.25 et au §5.27, et pour la même cause
  structurelle : une suppression est filtrée par la clause `USING`, et le serveur rend « aucune ligne
  retirée » **sans erreur**. MESURÉ sur la lectrice. Quitter l'écran sur ce silence annoncerait une
  suppression qui n'a pas eu lieu.

- **AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE SELON LE RÔLE** (§5.21, §5.23, §5.25, §5.26, §5.27, sans
  exception, et décision 509).

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : le geste emprunte au §5.3 sa teinte de
  danger, au §5.16 son icône, au §5.25 sa place et au §5.27 sa mécanique de confirmation.

> **RÉVISION DU §5.24 PAR LIVRAISON, 2026-08-26.** La phrase « la fiche porte désormais une
> commande, posée avant les deux zones » devient : **la fiche porte deux commandes**, « Modifier »
> puis « Supprimer ». Le reste du §5.24 est inchangé — le tableau des affaires se lit toujours à
> quatre colonnes, et son état vide ne gagne aucune commande.

### 5.41 Séquences de relance — `CRM-063`

**Neuvième surface de réglages**, et la quatrième de la famille « messagerie » qui écrive, après le
§5.34 — ce qu'on reçoit —, le §5.35 — ce qu'on expédie — et le §5.39 — le texte expédié. Celle-ci
porte la **cadence** qui enchaîne les textes. `docs/SPEC-modeles-emails.md` §13 dit ce que l'écran
lit, envoie et refuse ; les règles ci-dessous ne disent que de quoi il a l'air.

**Tout ce que le §5.39 pose vaut ici sans être répété** : `ul` de lignes plates et non tableau,
fiche repliée **dans le flux du document — aucune modale**, focus entrant dans le premier champ et
rendu à la commande qui l'a ouvert, commande d'enregistrement unique et **jamais désactivée par
l'état des champs**, refus `role="alert"` sous les champs sans effacer la saisie, état vide porteur
du geste, sélecteur jamais restreint selon le rôle, borne de liste à `104ch`. Seuls les **écarts**
sont écrits ci-dessous, et chacun a sa cause.

- **LE NOM EST EN TÊTE DE LIGNE, ET C'EST LA CLÉ** — `mail_sequences_workspace_name_key`. Même
  raisonnement qu'au §5.39.

- **LE NOMBRE DE PALIERS SUIT, EN SECOND TON, EN TOUTES LETTRES, DANS SON PROPRE ÉLÉMENT.** C'est
  l'écart le plus visible avec le §5.39, qui refuse tout compte sur une ligne de modèle, et il a une
  cause **mesurée** : une séquence sans palier n'arme rien — la base rend `sequence_empty` —, si
  bien que ce nombre est la seule donnée qui dise si la cadence est utilisable. Ce n'est donc pas
  « un chiffre qui ne dit pas ce qu'il compte » (§5.36). **L'accord se fait par clé** (§10), et le
  compte n'est jamais un nœud de texte accolé — défaut « Discussion1 » du §5.11.

- **AUCUNE PILULE, AUCUNE COULEUR.** Une séquence n'a pas d'état. Une cadence vide est un
  **brouillon**, pas une erreur : la teindre en danger ferait lire une panne là où il y a un travail
  en cours, et le §1 réserve la couleur à ce qui la mérite.

- **UNE SEULE COMMANDE PAR LIGNE, « Modifier ».** Rien à prévisualiser : une séquence n'a pas de
  texte propre, et le §5.39 prévisualise déjà les modèles vers lesquels ses paliers renvoient.

- **LES PALIERS SONT UNE LISTE ORDONNÉE, ET L'ORDRE EST LA DONNÉE.** La position **n'est jamais un
  champ saisissable** : c'est le rang dans la liste, déplacé par deux flèches. Deux chemins vers le
  même fait — un champ et des flèches — divergeraient au premier geste. Le rang se rend en
  `tabular-nums`, comme le retard du §5.37.

- **« Monter » SUR LE PREMIER ET « Descendre » SUR LE DERNIER SONT MONTÉS ET DÉSACTIVÉS**, et c'est
  le seul endroit de cette surface où une commande l'est. **Ce n'est pas un droit calculé** : c'est
  un geste sans objet sur cet élément-là, exactement comme le §5.31 désactive le report d'une
  occurrence sans suivante. Leur `aria-label` **nomme le palier** — deux flèches identiques répétées
  sur trois lignes ne diraient pas ce que chacune déplace.

- **UN DÉPLACEMENT RELIT LA LISTE, il ne la réordonne jamais localement.** L'écriture peut être
  refusée en silence par la politique — le serveur rend alors « zéro palier réordonné » —, et une
  liste réordonnée d'avance montrerait un ordre que la base n'a pas.

- **L'AJOUT D'UN PALIER NE DEMANDE PAS SA POSITION.** Le palier ajouté prend le rang suivant,
  calculé depuis la donnée **déjà lue**. Un champ de position ferait saisir deux fois la même
  intention.

- **« Retirer » N'A PAS DE CONFIRMATION, ET C'EST UN ÉCART MOTIVÉ AU §6.** Le geste ne détruit aucun
  texte : le modèle reste, la séquence reste, seule la ligne qui les relie disparaît, et la reposer
  est un formulaire de deux champs. La confirmation est réservée à l'**irréversible** ; l'étendre à
  ce qui ne l'est pas la ferait lire comme une formalité partout ailleurs.

- **LA CONFIRMATION DE SUPPRESSION D'UNE SÉQUENCE ANNONCE LA CASCADE ET LA RÈGLE.** La cascade est
  **comptée depuis la donnée déjà lue** — « ses 3 paliers seront supprimés avec elle » —, ce que la
  base applique vraiment (`on delete cascade`, mesuré). La règle qu'elle ne peut pas promettre est
  dite sans chiffre : une séquence **armée** ne se supprime pas, et l'écran ne lit pas les
  inscriptions pour en donner le nombre — ce nombre changerait entre la lecture et le geste.

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : l'écran emprunte au §5.39 sa forme
  entière, au §5.18 sa liste plate, au §5.5 ses variantes, au §5.29 son patron de suppression
  confirmée et au §9 ses flèches Lucide.

### 5.42 Armer une relance depuis l'affaire — `CRM-063`

Le geste qui applique une cadence à une affaire. Il vit dans la **colonne gauche de la fiche
d'affaire**, sous le bloc des contacts (§5.21) et **au-dessus** du geste de corbeille (§5.3) : c'est
un geste **sur l'affaire**, non un réglage, et le §5.21 a déjà posé ce raisonnement pour les
contacts.

- **LE BLOC EST TOUJOURS RENDU, ET SA COMMANDE N'EST JAMAIS ÉTEINTE — ni selon le rôle, ni selon
  l'état de l'affaire** (§5.3, §5.13, §5.21, §5.27, sans exception). En particulier, **l'écran ne
  calcule pas si l'affaire est figée** : cette définition vit dans la base, une seule fois, et la
  recopier ici en créerait une seconde. Le refus est **traduit**, en disant ce qu'il faudrait pour
  que le geste devienne possible.

- **DEUX ÉTATS, ET DEUX SEULEMENT**, parce que la donnée n'en porte que deux : aucune inscription
  active — le bloc porte le **geste** — ou une inscription active — le bloc porte l'**état** et
  « Interrompre ».

- **LES DEUX SÉLECTEURS OUVRENT SUR UNE OPTION VIDE**, séquence et adresse expéditrice, et aucun ne
  présélectionne : c'est la règle du §5.39, et le motif y est le même — le workspace porte deux
  identités également légitimes.

- **L'IDENTITÉ EST NOMMÉE `libellé — adresse`**, forme du §5.35, et la liste proposée est celle que
  l'envoi propose déjà : une seule règle d'emprunt, écrite une seule fois.

- **L'ÉTAT DIT OÙ EN EST LA CADENCE, ET RIEN DE PLUS** : le nom de la séquence, l'adresse
  expéditrice, et « aucun palier envoyé » ou « palier N envoyé le … ». **AUCUNE DATE DE PROCHAIN
  ENVOI** : la cadence glisse sur l'envoi réel, et une échéance affichée serait fausse dès qu'un
  passage manquerait — c'est la donnée qu'on n'a pas, du §5.9.

- **LES INSCRIPTIONS FERMÉES NE SONT PAS LISTÉES.** Le bloc porte un geste, pas une histoire ;
  l'histoire de l'affaire est le fil du §5.11.

- **L'INTERRUPTION RELIT L'INSCRIPTION.** Le serveur rend `204` même quand rien n'a été fermé —
  l'appel est idempotent —, et annoncer une interruption sur ce silence serait annoncer un succès
  qui n'a pas eu lieu (§5.29, §5.40).

- **Aucune couleur, aucun jeton, aucune icône nouvelle** : le bloc emprunte au §5.21 sa place et sa
  forme, au §5.5 ses variantes, au §5.8 ses états et au §5.35 le libellé de ses identités.

### 5.43 Cloche et panneau de notifications — `CRM-064`

**Première surface de l'en-tête depuis `CRM-009`**, et la première du produit dont l'objet est un
**état de l'utilisateur courant** plutôt qu'un objet métier. Spécifiée avant code,
`docs/SPEC-notifications.md` §22 à §31 ; les règles ci-dessous ne disent que de quoi elle a l'air.

**Elle vit dans l'EN-TÊTE, entre le contexte d'espace de travail et l'identité de session**, et
l'ordre porte un sens (§23.1 de la spécification) : ce que le produit a à me dire précède qui je
suis, et le geste qui **sort** du produit ferme la ligne. Ce n'est pas une entrée de barre latérale
— le §4 y range les **destinations**, et une boîte de notifications n'en est pas une : on y jette
un œil, on suit un lien, on revient à ce qu'on faisait.

- **LA CLOCHE EST UN BOUTON, ICÔNE `Bell`, ET SON NOM ACCESSIBLE PORTE LE COMPTE EXACT.** « 3
  notifications non lues » et non « Notifications » : un chiffre dessiné sur une icône n'existe pas
  pour un lecteur d'écran, et le §1 vaut ici comme partout. Elle porte `aria-expanded` et
  `aria-controls` vers le panneau, comme la commande « Modifier » du §5.3 ter. Cible
  `--size-target`, sans exception (§8).

- **LE COMPTEUR EST UNE PASTILLE `--color-brand` À TEXTE `--color-white`, POSÉE SUR LA CLOCHE**, en
  `--text-xs` `tabular-nums`, `rounded-full`. **Pas `--color-danger`** : une mention n'est pas une
  erreur, et la teinte de danger est réservée à ce qui échoue ou détruit (§1, §5.31 pour la pilule
  « clôturé », §5.41 pour la séquence vide). C'est le seul endroit du produit où `--color-white` se
  pose sur un aplat de marque hors d'un bouton primaire, et c'est exactement l'emploi que le §1 lui
  réserve.

- **IL EST ABSENT TANT QUE LE COMPTE N'EST PAS CONNU, et absent à zéro** — la règle du §5.31 pour
  le badge de l'onglet « À saisir », reprise sans changement et pour ses deux motifs : un « 0 »
  pendant la lecture affirmerait que tout est lu alors que rien n'a été lu, et à zéro l'absence dit
  déjà ce que le chiffre répéterait.

- **AU-DELÀ DE 99, LA PASTILLE ÉCRIT « 99+ », ET LE NOM ACCESSIBLE GARDE LE COMPTE EXACT.** Un
  badge à quatre chiffres déformerait la cloche ; une troncature qui ne serait nulle part rattrapée
  serait une donnée perdue. C'est la règle du §5.15 pour l'empreinte tronquée à douze caractères —
  l'œil reçoit la forme, la technologie d'assistance reçoit la valeur.

- **SANS SESSION, LA CLOCHE N'EST PAS RENDUE.** L'en-tête rend « Se connecter » à sa place (§5.12).
  Une cloche offerte à un anonyme annoncerait une boîte qu'aucune session ne peut remplir, et son
  compteur serait un zéro permanent — la commande morte que le §5.10 proscrit.

- **LE PANNEAU EST ANCRÉ À LA CLOCHE, DANS LE FLUX DU DOCUMENT — AUCUNE MODALE.** Le §5 n'en
  déclare aucune, et `CRM-043` puis `CRM-075` l'ont tranché deux fois. Surface `--color-surface`,
  `--radius-lg`, bordure `--color-border`, `--shadow-card-hover`, largeur bornée à `40ch` — celle
  d'une colonne de prose courte, une ligne portant un extrait de phrase. Il se ferme par `Échap`,
  par un clic hors de lui, et par la cloche.

- **LA CLOCHE RESTE RENDUE PENDANT QUE LE PANNEAU EST OUVERT**, et c'est l'écart avec le §5.3
  quater — « le panneau remplace la commande, il ne s'y ajoute pas ». Le motif : elle est l'**ancre
  visuelle** du panneau et porte son `aria-expanded` ; la démonter ferait sauter la largeur de
  l'en-tête et laisserait le focus sur un bouton disparu. C'est la situation du §5.27, où la
  commande reste montée : **le retour du focus n'a donc pas à être différé**, et aucune
  temporisation n'est écrite (`CLAUDE.md` §18).

- **UNE NOTIFICATION EST UNE LIGNE, PAS UNE CARTE.** C'est la distinction que le §5.11 a posée pour
  le fil — « l'un est une parole, l'autre un fait » — et elle vaut ici : une notification **date un
  fait**. Hauteur libre, bordure basse `--color-border`, survol `--color-hover`, aucune zébrure : la
  liste plate du §5.18, dont les lignes gagnent de la hauteur pour porter leur extrait, comme celles
  du §5.21.

- **L'ÉTAT DE LECTURE SE REND PAR LA FORME, JAMAIS PAR LA PLACE.** Une ligne non lue porte un
  **liseré gauche de 3 px `--color-brand`** et son libellé en graisse moyenne ; une ligne lue n'en
  porte pas. C'est le liseré de la carte de board (§5.1) tourné d'un quart de tour, celui-là même
  que le §5.7 quater emploie déjà — aucun jeton n'est ajouté. **Le §1 est tenu par un MOT** : le nom
  accessible du bouton de marquage dit « Marquer comme lue » ou « Marquer comme non lue », et
  l'information ne repose donc jamais sur le seul liseré.

- **L'ORDRE EST LE PLUS RÉCENT EN HAUT, ET C'EST L'INVERSE DU §5.10.** L'écart est **voulu** et
  écrit ici pour qu'on ne l'aligne pas par habitude : une conversation se lit dans le sens où elle
  s'est tenue, une boîte de réception se lit en commençant par ce qui vient d'arriver. **Les non-lues
  ne remontent pas** : un second critère de tri ferait sauter une ligne d'un endroit à l'autre au
  moment précis où on vient de la marquer.

- **LA LIGNE PORTE TROIS CHOSES ET UN LIEN** : l'auteur avec son avatar 24 px — celui du §5.10 —,
  l'extrait du propos borné à l'affichage, et l'affaire en **pilule « Track › Channel »** du §5.29,
  réemployée sans copie. La date est **absolue et en donnée technique** (§2), comme celle d'un
  commentaire (§5.10). **Le titre de l'affaire est le lien**, jamais la ligne entière : la cible du
  clic doit être la cible annoncée (§5.9, §5.13).

- **UNE LIGNE DONT LE COMMENTAIRE N'EST PLUS LISIBLE GARDE SA PLACE, SANS AUTEUR NI EXTRAIT.** Elle
  conserve l'affaire, la date et le lien. Elle **ne dit ni** que le propos a été supprimé **ni**
  qu'il est devenu illisible : les deux causes sont indistinguables, et les nommer divulguerait ce
  que la seconde cache — la règle du §5.39 pour un rendu à zéro ligne, et du §5.33 pour ce que
  l'écran ne montre pas. C'est le cas normal d'un propos retiré, pas une panne.

- **LE MARQUAGE EST SON PROPRE BOUTON, DISCRET COMPACT, SUR LA LIGNE**, avec les icônes `MailOpen`
  et `Mail` — deux visages, un seul rendu à la fois, le patron du §5.15 pour `Archive` /
  `ArchiveRestore`. **Le clic sur le lien ne marque rien** : suivre un lien et marquer lu sont deux
  gestes, et les fondre ferait disparaître du compteur une notification qu'on a effleurée en visant
  autre chose. Aucune de ces deux icônes ne sert ailleurs dans le produit (§9).

- **LA LIGNE NE CHANGE QU'APRÈS LA RÉPONSE DU SERVEUR** — le marquage n'est **pas** optimiste,
  contrairement au déplacement d'une card (§6). C'est la règle du §5.3 sexies pour la mise en
  sommeil, et pour son motif exact : le geste change aussi le **compteur**, visible ailleurs sur
  l'écran, et une annulation ferait clignoter deux endroits à la fois.

- **L'ISSUE « SANS EFFET » EST DITE**, comme aux §5.25, §5.27, §5.28 et §5.40, et pour la même cause
  structurelle : la clause `USING` filtre en silence et le serveur rend `204` sans erreur. Le
  message vit **sous la liste**, `role="alert"`, jamais en tête du panneau, et il **survit à la
  relecture** — la place que le §5.21 lui donne déjà.

- **AUCUN FILTRE, AUCUNE PAGINATION, AUCUN « TOUT MARQUER COMME LU ».** Les trois absences sont
  motivées au §23.3 de la spécification. **La troncature est ÉCRITE** quand la liste est pleine —
  « les 20 plus récentes » —, jamais laissée à deviner : c'est la règle du §5.15 pour le plan de
  remappage, où « 3 affaires listées sur 13 » s'écrit en toutes lettres.

- **L'ÉTAT VIDE N'OFFRE AUCUNE ACTION, ET SON MESSAGE DIT QUE L'ÉTAT EST SAIN** — l'écart au §5.8
  que la corbeille (§5.16), le carnet (§5.19) et les affaires figées (§5.37) prennent déjà. « Aucune
  notification » est une bonne nouvelle, pas un manque.

- **LE PANNEAU EST UNE RÉGION NOMMÉE, ET SON OUVERTURE DÉPLACE LE FOCUS DANS LUI** (§5.13). `Échap`
  le referme depuis n'importe lequel de ses contrôles et rend le focus à la cloche — la règle du
  §5.29 tranche 2 g pour les trois surfaces de la liste des tableaux, reprise sans changement.

- **SOUS LE PALIER `md`, LE PANNEAU OCCUPE LA LARGEUR DISPONIBLE MOINS 16 px DE MARGE.** `md` et
  jamais `sm`, qui est un variant inconnu que Tailwind supprime en silence (§11, §5.20). **La page
  ne défile jamais horizontalement** (§7).

- **IL EST ANCRÉ À L'EN-TÊTE, ET NON À LA CLOCHE, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT UNE
  CAPTURE** (`CLAUDE.md` §16, `docs/captures/CRM-064/notifications-panneau-sm-390.jpg`, 2026-08-26).
  Cette entrée écrivait « aligné sous la cloche et jamais débordant à droite » : elle ne parlait que
  d'un bord. Ancré sur la cloche, le panneau alignait son bord **droit** sous elle, si bien qu'à
  390 px sa largeur le faisait sortir de l'écran **par la gauche** — la moitié de la ligne était
  hors cadre. L'en-tête occupant toute la largeur, l'y ancrer borne le panneau des **deux** côtés.
  La règle vaut pour **toute** surface flottante ancrée à un contrôle proche d'un bord : le repère
  de positionnement est le conteneur pleine largeur, jamais le contrôle.

  **La preuve de débordement ne le voyait pas non plus**, et c'est la seconde moitié de la leçon :
  `scrollWidth > clientWidth` ne mesure qu'un débordement à **droite**, une coordonnée négative
  n'engendrant aucun défilement. Toute preuve de palier portant sur une surface flottante mesure
  désormais son **cadre** — bord gauche ≥ 0, bord droit ≤ largeur de la fenêtre.

- **LA LIGNE SE REPLIE, ELLE NE TRONQUE NI LE NOM NI LE TITRE, ET C'EST UN SECOND DÉFAUT TROUVÉ SUR
  LA MÊME CAPTURE.** Écrite d'abord avec le titre de l'affaire, sa pilule et le bouton de marquage
  sur une seule ligne, elle rendait « Refonte d… » dans une colonne de `40ch` où la pilule,
  `shrink-0`, prenait toute la place : le lien ne nommait plus l'affaire qu'il ouvre. La phrase de
  mention, elle, rendait « Camille Aubert vous a ment… », coupant le nom de la personne qui écrit —
  c'est-à-dire l'information même de la ligne. **Le titre occupe donc sa propre ligne**, et la
  phrase **se replie**. C'est le repli d'une liste plate (§5.21, §5.37) : la réponse au manque de
  place est de gagner de la hauteur, jamais de tronquer une donnée. L'ellipse du §5.9 est la règle
  d'un **tableau**, qui se balaye en diagonale ; un panneau de `40ch` n'en est pas un.

- **Aucune couleur, aucun jeton nouveau** : la surface emprunte au §5.18 sa liste plate, au §5.29 sa
  pilule de channel, au §5.10 son avatar et sa date, au §5.1 son liseré, au §5.5 ses variantes et au
  §5.8 ses états. **Trois icônes Lucide nouvelles** — `Bell`, `Mail`, `MailOpen` —, aucune ne
  servant déjà un autre objet (§9).

### 5.44 Sélecteur de mentions du composeur — `CRM-064`

Le contrôle par lequel un auteur choisit qui son commentaire mentionne. Spécifié avant code,
`docs/SPEC-notifications.md` §33 à §36 ; les règles ci-dessous ne disent que de quoi il a l'air.

**Il vit DANS le composeur du fil (§5.10, §5.11), sous la zone de saisie et au-dessus du bouton de
publication.** Ce qu'il choisit part avec le commentaire et disparaît avec lui ; le poser dans
l'en-tête du panneau le ferait passer pour un filtre du fil (§5.11).

- **CE N'EST PAS UN `select`, ET L'ÉCART AVEC LE §5.22 EST MOTIVÉ.** Là-bas le choix est unique, et
  un `select` natif porte la recherche au clavier, le rendu du système et le focus visible sans une
  ligne de code. Ici le choix est **multiple** : un commentaire peut mentionner plusieurs personnes.
  `<select multiple>` est le contrôle que les plateformes rendent le plus mal — sélection à la
  souris destructrice, hauteur illisible sous le palier `md` —, et le §8 exige mieux. Le sélecteur
  est un **`fieldset` de cases à cocher**, une par personne, avec sa `legend`.

- **IL EST REPLIÉ PAR DÉFAUT, ET SA COMMANDE PORTE LE COMPTE.** Bouton discret compact, icône
  `AtSign`, `aria-expanded` et `aria-controls` — le patron du §5.13. Le libellé porte le nombre de
  personnes cochées, parce qu'un auteur qui replie le sélecteur ne saurait plus, sinon, qui son
  commentaire mentionne. `AtSign` ne sert nulle part ailleurs dans le produit (§9), et c'est la
  seule apparition de la syntaxe `@` : elle est un **signe**, jamais une saisie (§4.4 de la
  spécification).

- **LA LISTE N'EST LUE QU'À LA PREMIÈRE OUVERTURE**, jamais au chargement de la fiche — la règle du
  §5.7 ter pour la liste des responsables, et pour le même motif mesuré : la plupart des visites
  d'une affaire ne mentionnent personne.

- **LES QUATRE ÉTATS SONT TRAITÉS (§5.8), ET LE VIDE N'EST PAS UNE PANNE.** Chargement : `aria-busy`
  et aucune case. Erreur : la mention et son **action de reprise**, qui relit la liste. Vide :
  « personne d'autre ne peut lire cette affaire », **sans action** — l'écart au §5.8 que prennent
  déjà la corbeille (§5.16) et le carnet (§5.19). Peuplé : les cases, dans l'ordre du serveur.

- **UNE CASE PORTE UN NOM ET UN AVATAR**, réemployant `Avatar` (§5.4) et la présentation d'identité
  du §5.10. Le nom est une **donnée**, jamais une traduction (§10). Aucune case ne porte de niveau
  d'accès ni de rôle : la liste dit qui peut être mentionné, jamais pourquoi — nommer la cause
  ferait du sélecteur un moyen de sonder les droits d'autrui (§6 de la spécification).

- **L'APPELANT N'EST JAMAIS DANS SA PROPRE LISTE**, et c'est la base qui l'en retire (§34.3 de la
  spécification). L'écran ne prévoit **aucun** rendu pour ce cas : écrire un repli pour un état que
  la base interdit enseignerait qu'il peut arriver — la règle du §5.43 pour la ligne dont l'affaire
  est illisible.

- **LE REFUS PARTIEL EST NOMMÉ, ET IL NOMME LES PERSONNES.** Quand le commentaire est publié mais
  qu'une mention est refusée, l'alerte vit **sous le composeur**, `role="alert"`, et écrit qui n'a
  pas été mentionné et pourquoi. C'est la place et la forme que le §5.10 donne au refus de
  publication, et la règle des trois issues du §5.43 : un succès partiel n'est ni un succès, ni un
  échec, et le confondre avec l'un ou l'autre ferait croire à un effet qui n'a pas eu lieu.

- **APRÈS UN REFUS PARTIEL, LE BROUILLON EST VIDÉ ET LE SÉLECTEUR NE GARDE QUE LES REFUSÉS.** C'est
  l'écart assumé avec le §5.10, qui conserve le texte après un refus : ici le commentaire **existe**,
  et le reproposer ferait publier deux fois le même propos. Ce qui reste coché est exactement ce
  qu'il reste à faire.

- **LE SÉLECTEUR NE DÉSACTIVE RIEN ET N'EXIGE RIEN.** Le bouton de publication reste gouverné par le
  seul corps du commentaire (§5.10). Mentionner est facultatif ; un composeur qui exigerait un choix
  changerait le geste que `CRM-043` a livré.

- **Aucune couleur, aucun jeton nouveau.** Le contrôle emprunte entièrement au §5.7, au §5.10 et au
  §5.13.

### 5.45 Écran des préférences de notification — `CRM-064`

L'écran par lequel une personne décide de ce qu'elle reçoit. Spécifié avant code,
`docs/SPEC-notifications.md` §41 à §49 ; les règles ci-dessous ne disent que de quoi il a l'air.

**Il vit sous `/reglages/notifications`, et c'est la PREMIÈRE section PERSONNELLE de `/reglages`.**
Les sections existantes administrent l'instance — arborescence, workflows, catalogue, comptes et
identités de messagerie, modèles, séquences, corbeille, état de la messagerie. Celle-ci n'administre
rien : elle règle **le compte de qui la regarde**. L'index de `/reglages` la place donc **en
dernier**, et son texte secondaire dit ce qu'elle règle — « ce que vous recevez » — là où les autres
disent ce qu'elles configurent. Elle n'est **pas** réservée à l'administratrice : les trois profils
l'ouvrent, et c'est la première entrée de `/reglages` dont ce soit le cas.

- **UNE LIGNE PAR TYPE DE NOTIFICATION, ET IL N'Y EN A QU'UN.** Une case à cocher par type, son
  libellé, et une phrase secondaire disant ce que le type recouvre. Le patron est celui du §5.13
  pour l'étiquette et le focus, et la case emprunte au `fieldset` du §5.44 sans en reprendre le
  repli : il n'y a rien à replier.

- **LA CASE DIT CE QU'ON REÇOIT, JAMAIS CE QU'ON COUPE.** « Recevoir les mentions », cochée par
  défaut. Une case « Couper les mentions » demanderait de cocher pour obtenir moins, et une case
  cochée voudrait dire une notification en moins : la double négation est une faute de lisibilité
  que le §10 interdit. L'état par défaut du produit — recevoir — est donc l'état **coché**, ce que
  le §43.4 de la spécification pose en base par l'absence de ligne.

- **AUCUNE CASE POUR UN CANAL QUI N'EXISTE PAS.** Ni « par email », ni « résumé quotidien » : le
  §42.1 de la spécification le mesure, aucun canal sortant n'existe. Une case qui ne commande rien
  est la **commande morte** du §5.10, et ici elle serait pire qu'inerte — elle promettrait un email.

- **L'ÉCRAN ÉCRIT IMMÉDIATEMENT, SANS BOUTON « ENREGISTRER », ET C'EST LE MODE DU §5.7 ter.** Un
  réglage à une seule valeur n'a rien à valider, et un bouton d'enregistrement y ajouterait un état
  intermédiaire — « modifié, non enregistré » — que rien ne justifie. Les six règles du §5.7 ter
  s'appliquent **telles quelles**, et deux méritent d'être redites ici parce qu'on les enfreint par
  réflexe : la mention d'état vit **sous la case**, jamais en tête d'écran ; et **la case n'est
  jamais désactivée pendant l'envoi** — un contrôle désactivé perd le focus du clavier, ce que le
  §5.13 interdit.

- **LA CASE NE SE COCHE QU'APRÈS LA RÉPONSE, jamais par anticipation optimiste.** Le §46.3 de la
  spécification rend cela possible en faisant rendre la **ligne retenue** par la RPC : l'écran
  affiche ce que la base porte, jamais ce qu'il croyait envoyer. Une case cochée par anticipation
  puis décochée par un refus serait un état que l'utilisateur a vu et qui n'a jamais existé.

- **LES QUATRE ÉTATS SONT TRAITÉS (§5.8), ET IL N'Y A PAS D'ÉTAT VIDE.** Chargement : `aria-busy`
  et **aucune case rendue** — l'état d'une case n'est pas connu avant la lecture, et en rendre une
  cochée « en attendant » afficherait un état que la base n'a pas confirmé. Désactiver une case déjà
  rendue serait pire encore : le §5.7 ter l'interdit. Erreur de lecture : la mention et son
  **action de reprise**. Erreur
  d'écriture : la mention de refus du §5.7 ter, sous la case, qui **ne l'efface pas** et laisse la
  case à l'état que la base porte. Peuplé : les cases. L'état vide n'existe pas : la liste des types
  est **fixe**, elle ne vient pas du serveur.

- **AUCUNE COULEUR, AUCUN JETON NOUVEAU.** L'écran emprunte au §5.7 ter, au §5.8 et au §5.13.

- **CLAVIER DE BOUT EN BOUT (§8).** La navigation atteint chaque case par tabulation, l'espace la
  bascule, et le focus **reste sur elle** pendant et après l'écriture. C'est la conséquence directe
  de la règle du §5.7 ter qui refuse de désactiver le contrôle : une case qui perdrait le focus en
  se réactivant obligerait à retabuler pour se corriger.

### 5.46 Palette de recherche de l'en-tête — `CRM-065`

**La surface que le §4 annonce depuis `CRM-000`** — « En-tête : fil d'Ariane · **recherche · Cmd+K** ·
profil » — et que rien ne rendait, faute de moteur. Le moteur est livré par la tranche 1 de
`CRM-065` ; cette entrée dit de quoi sa surface a l'air. Spécifiée avant code,
`docs/SPEC-recherche.md` §12 à §14.

**Elle vit dans l'en-tête, entre le fil d'Ariane et le contexte d'espace de travail**, à la place
exacte que le §4 lui donne. L'ordre de la ligne devient : fil d'Ariane, **recherche**, contexte,
cloche, identité. Le §5.43 a posé le sens de la fin de cette ligne ; la recherche vient **avant**
parce qu'elle porte sur le produit entier, et non sur l'utilisateur.

- **AUCUNE MODALE, ET C'EST LE CAS OÙ L'ON EST LE PLUS TENTÉ D'Y DÉROGER.** Le §5 n'en déclare
  aucune, et `CRM-043`, `CRM-075`, `CRM-079`, `CRM-060` puis `CRM-064` l'ont tranché **cinq** fois.
  L'usage du marché veut une fenêtre centrée sur un voile ; la palette n'en est pas une, et le motif
  n'est pas la conformité : **le voile cacherait l'écran d'où l'on cherche**. C'est le raisonnement
  du §5.23 — « une modale recouvrirait la liste que l'on vient de lire, or cette liste est
  précisément ce qui dit si le contact existe déjà » — dans son cas le plus général : on cherche
  **depuis** quelque part, et ce quelque part est le contexte de ce qu'on cherche. Le panneau est
  donc ancré, dans le flux, sur le patron entier du §5.43 — surface `--color-surface`,
  `--radius-lg`, bordure `--color-border`, `--shadow-card-hover`.

- **ANCRÉ À L'EN-TÊTE, JAMAIS AU CHAMP**, et la règle est déjà payée : le §5.43 l'a apprise en
  regardant une capture — « le repère de positionnement est le conteneur pleine largeur, jamais le
  contrôle ». Sous `md` le panneau s'étend d'un bord à l'autre moins 16 px de marge ; à partir de
  `md` il retrouve une colonne bornée. `md` et jamais `sm`, qui est un variant inconnu que Tailwind
  supprime en silence (§11, §5.20).

- **LE CHAMP EST UN `input type="search"` AVEC SON LIBELLÉ, jamais un bouton qui ouvre un champ.** Un
  champ visible dit ce qu'on peut faire ; un bouton demanderait d'apprendre qu'il en cache un. Il
  suit le §5.7 — 40 px de haut, bordure `--color-border`, focus `--color-brand` — et porte l'icône
  `Search` en `aria-hidden`, la seule icône nouvelle de cette surface (§9), qui ne sert nulle part
  ailleurs. **Son libellé est visuellement masqué, jamais retiré** (§12.3) : l'icône et la place
  disent déjà ce qu'il est, et un libellé visible dans une ligne d'en-tête déjà dense pousserait le
  titre de route hors du cadre (§12.2).

- **LE RACCOURCI EST ÉCRIT DANS LE CHAMP, EN PASTILLE `kbd`**, à droite, `--color-hover` /
  `--color-text-3`, `--text-xs`, `--radius-sm`. Un raccourci qu'aucun écran n'enseigne n'existe que
  pour qui le connaît déjà. Elle est `aria-hidden` — le nom accessible du champ le dit en toutes
  lettres —, et **elle disparaît dès que le champ porte du texte** : elle occuperait la place de ce
  qu'on écrit. Sous `md` elle n'est **pas rendue** : il n'y a pas de clavier à qui l'enseigner, et
  la place manque.

- **LE FOCUS NE QUITTE JAMAIS LE CHAMP, ET C'EST CETTE RÈGLE QUI DÉCIDE LA FORME.** Les flèches
  déplacent un **résultat actif**, pas le focus : l'utilisateur corrige son terme en permanence,
  c'est le geste même d'une palette, et un focus descendu dans la liste ferait perdre la frappe
  suivante. Le champ est donc une `combobox` — `role="combobox"`, `aria-expanded`, `aria-controls`,
  et `aria-activedescendant` désignant la ligne active —, la liste une `listbox`, et chaque ligne
  une `option` portant son `id`. **C'est le premier `aria-activedescendant` du produit**, et il est
  employé parce qu'aucun autre patron ne tient les deux exigences à la fois.

  *Écart assumé avec le §5.44*, qui refuse un patron ARIA composite pour un `fieldset` de cases : là
  le choix est **multiple** et sans urgence de frappe ; ici il est **unique** et se fait en tapant.

- **LE RÉSULTAT ACTIF SE MARQUE PAR UN FOND `--color-brand-soft` ET UN LISERÉ GAUCHE DE 3 px
  `--color-brand`** — le liseré de la carte de board (§5.1) tourné d'un quart de tour, celui du
  §5.7 quater et de la ligne non lue du §5.43. **Aucun jeton n'est ajouté.** Le §1 est tenu par
  `aria-activedescendant`, qui porte l'information indépendamment du visuel, et par le survol, qui
  emploie `--color-hover` et ne se confond donc pas avec l'état actif.

- **UNE LIGNE EST UNE LIGNE, PAS UNE CARTE** — la distinction du §5.11 et du §5.43. Elle porte,
  dans cet ordre : la **pilule de famille**, le **titre**, le **sous-titre**, puis l'**extrait**
  quand il existe. Hauteur libre, bordure basse `--color-border`, survol `--color-hover`, aucune
  zébrure : la liste plate du §5.18.

- **LA FAMILLE EST UNE PILULE NEUTRE PORTANT UN MOT, jamais une icône seule ni une teinte** (§1,
  §9). « Affaire », « Contact », « Organisation », « Commentaire », « Message » —
  `--color-hover` / `--color-text-2`, `rounded-full`, `--text-xs` (§5.6). Cinq icônes muettes
  demanderaient une légende ; cinq couleurs feraient porter par la teinte une information que le mot
  donne. **Elle est en TÊTE de ligne** et non en fin, contrairement à la pilule de channel du
  §5.36 : elle dit **de quoi il s'agit** avant de dire lequel, et une liste qui mélange cinq natures
  se lit dans cet ordre-là.

- **L'EXTRAIT EST DU TEXTE PUR, ET IL TIENT SUR UNE LIGNE.** Le §6.5 de la spécification le rend
  déjà replié et sans balise, mesuré ; l'écran l'affiche en `--text-sm` `--color-text-2` avec une
  ellipse. C'est le seul endroit de cette surface où l'ellipse du §5.9 s'applique plutôt que le
  repli du §5.21 : l'extrait est un **échantillon**, pas une donnée dont la troncature perdrait
  quelque chose. **Le titre et le sous-titre, eux, se replient** — ils nomment l'objet, et le §5.43
  a déjà payé ce défaut en regardant une capture : « le lien ne nommait plus l'affaire qu'il ouvre ».

- **UNE LIGNE SANS DESTINATION RESTE RENDUE, SANS LIEN.** Elle garde son titre, son sous-titre et
  son extrait ; elle n'est ni cliquable, ni atteignable par `Entrée`, et une mention en `--text-xs`
  `--color-text-3` dit que l'objet n'est pas atteignable. C'est la règle du §5.37 pour une affaire
  figée que la seconde lecture n'a pas rapportée, et du §5.32 pour une affaire sans slug : la
  masquer retrancherait un résultat de la liste qui existe pour les montrer ; lui donner un lien
  vers une adresse incomplète mènerait à un écran que l'utilisateur croirait cassé.

- **LES QUATRE ÉTATS DU §5.8 SONT TRAITÉS, PLUS L'ÉTAT D'ARRIVÉE, QUI N'EST PAS UN VIDE.** Terme
  vide : **aucune liste**, et une phrase qui dit ce que la recherche cherche — cinq familles nommées.
  Erreur : la mention et son **action de reprise**, qui rejoue la même recherche. Vide :
  « aucun résultat pour ce terme », **sans action** — l'écart au §5.8 que le §5.16, le §5.19, le
  §5.37 et le §5.43 prennent déjà, et le message dit que la recherche a **abouti**, pas qu'elle a
  échoué.

- **LA LISTE PRÉCÉDENTE RESTE AFFICHÉE PENDANT LA RECHERCHE SUIVANTE**, sous `aria-busy`, et c'est
  un second écart au §5.8 **motivé**. Le squelette reste réservé au **premier** chargement — la
  règle exacte du §5.29 tranche 2 c —, seul moment où il n'y a rien à montrer. Une frappe arrivant
  200 ms après la précédente (`docs/SPEC-recherche.md` §13.3), remplacer la liste par un squelette à
  chaque lettre la ferait **clignoter**, ce que le §6 interdit.

- **LA TRONCATURE EST ÉCRITE, jamais laissée à deviner** : « 20 résultats affichés » sous la liste
  quand elle est pleine, en `--text-xs` `--color-text-3`. C'est la règle du §5.43 pour « les 20 plus
  récentes » et du §5.15 pour « 3 affaires listées sur 13 ».

- **SANS SESSION, LE CHAMP N'EST PAS RENDU**, et le raccourci est inactif. C'est la règle du §5.43
  pour la cloche : la RPC refuse l'anonyme par le **privilège**, et un champ offert à un anonyme
  promettrait une recherche que la base refuse — la commande morte du §5.10.

- **`ÉCHAP` REFERME ET REND LE FOCUS**, un clic hors du panneau le referme sans rendre le focus — la
  distinction que le §5.43 fait entre fermer et annuler, reprise sans changement.

- **LE PANNEAU N'A NI BARRE DE TITRE, NI COMMANDE DE FERMETURE, et c'est l'écart au §5.43 qu'il faut
  écrire pour qu'on ne le recopie pas sans son motif.** Le panneau de notifications en porte une
  parce que sa cloche est une icône : sans elle, rien à l'écran ne dirait comment refermer ce qui
  vient de s'ouvrir. Ici **le champ reste rendu au-dessus du panneau**, il porte son
  `aria-expanded`, et il est le geste même qui l'a ouvert : une commande « Fermer » dupliquerait
  `Échap` et le clic hors du panneau à l'endroit exact où l'on veut continuer à taper. Un titre
  serait pire encore — il répéterait le libellé du champ, à trois lignes de lui.

- **SOUS `lg`, LE CHAMP CÈDE LA PLACE AU TITRE DE ROUTE ET DEVIENT UNE COMMANDE À ICÔNE**, cible
  `--size-target`, nom accessible complet (§12.3). C'est le §12.2 appliqué : l'ordre de sacrifice
  de l'en-tête ne touche jamais le titre de la route, et un champ de saisie à 390 px le pousserait
  hors du cadre. La commande ouvre le **même** panneau, qui occupe alors la largeur disponible moins
  la marge. **La page ne défile jamais horizontalement** (§7).

  **`lg` ET NON `md`, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT LA CAPTURE D'UNE AUTRE UNITÉ**
  (`CLAUDE.md` §16, `docs/captures/CRM-076/workflows-md-900.jpg`) : à 900 px, un champ de `28ch`
  laissait au titre « Éditeur de workflows » de quoi rendre **« Édit… »**. Un titre présent et
  illisible ne vaut pas mieux qu'un titre absent, et le §12.2 le range parmi ce qui ne se sacrifie
  pas. **La règle vaut au-delà de ce champ** : le seuil auquel un occupant de l'en-tête doit céder
  se mesure sur le **titre de route le plus long du produit**, jamais sur celui de l'écran qu'on a
  sous les yeux.

- **LA COMMANDE DISPARAÎT PENDANT QUE LE CHAMP EST OUVERT, ET CE PARAGRAPHE ÉTAIT INCOMPLET.** Il
  écrivait « la commande ouvre le **même** panneau » sans dire d'où le champ viendrait : rendu
  `hidden` sous `md` sans condition, il ouvrait **un panneau où l'on ne peut pas taper** — la
  commande morte du §5.10, dans sa forme la plus complète. Défaut trouvé **en exécutant la preuve
  de palier**, jamais à la lecture. La commande et le champ **s'excluent**, patron du §5.3 quater.

- **OUVERT SOUS `lg`, LE CHAMP PREND LA LIGNE, ET LA FIN DE L'EN-TÊTE CÈDE — contexte, cloche et
  identité comprises.** Défaut trouvé **en regardant une capture** (`CLAUDE.md` §16,
  `docs/captures/CRM-065/recherche-palette-sm-390.jpg`) : à 390 px, ces trois-là laissaient au champ
  **soixante pixels**, où l'on ne lisait plus ce que l'on venait de taper. Un champ de recherche
  dont la saisie est invisible n'est pas un champ de recherche. C'est encore le §5.3 quater — le
  panneau remplace la commande, il ne s'y ajoute pas — appliqué à une **ligne entière**, et `Échap`
  la restaure. **Le §12.2 n'est pas contredit** : il régit l'en-tête **au repos**, et la fermeture
  est le point d'accès que le §7 exige.

- **À PARTIR DE `lg`, LE PANNEAU S'ALIGNE SUR LE BORD GAUCHE DU CHAMP ; en dessous, il garde
  l'ancrage à l'en-tête.** Troisième défaut trouvé **en regardant une capture** : ancré à l'en-tête
  à 1440 px, le panneau se collait au bord **droit** alors que le champ vit au milieu-gauche, et le
  lien visuel entre la saisie et ses résultats était rompu. **Ce n'est pas une entorse à la leçon du
  §5.43** — « le repère de positionnement est le conteneur pleine largeur, jamais le contrôle » : ce
  qu'elle protège est le **bornage des deux côtés** d'une surface ancrée à un contrôle **proche d'un
  bord**, ce qu'est la cloche et ce que le champ n'est pas. Sous `md`, là où la place manque
  réellement, l'ancrage à l'en-tête est conservé. Le cadre est **mesuré aux quatre paliers**, bord
  gauche ≥ 0 et bord droit ≤ largeur de la fenêtre.

- **LE CONTENEUR DU CHAMP EST L'ÉLÉMENT FLEX DE L'EN-TÊTE, ET C'EST LUI QUI DOIT CÉDER.** Écrit
  `shrink-0`, il empêchait le champ de se comprimer **quelle que soit la classe de son enfant**, et
  l'identité de session sortait du cadre de trente-six pixels à 390 px. La règle vaut pour **toute**
  surface élastique posée dans une ligne flex : la classe qui décide est celle de l'élément flex,
  jamais celle de son contenu. **Une preuve de palier nomme le coupable** — l'élément et sa
  coordonnée droite — plutôt que de dire « ça déborde » : sans cela, elle fait chercher au mauvais
  endroit.

- **Aucune couleur, aucun jeton nouveau** : la surface emprunte au §5.43 son panneau ancré et sa
  mécanique de fermeture, au §5.18 sa liste plate, au §5.6 sa pilule neutre, au §5.1 son liseré, au
  §5.7 son champ et au §5.8 ses états. **Une seule icône Lucide nouvelle — `Search` —**, qui ne sert
  aucun autre objet (§9).

### 5.47 Occurrences d'un budget récurrent — `CRM-084` tranche 3

La sous-surface arbitrée par `docs/SPEC-costs.md` §4.1 bis (INC-173, tranchée le 2026-08-28). Ce
qu'elle **fait** est spécifié là-bas ; les règles ci-dessous ne disent que de quoi elle a l'air.
Elle vit **dans** le bloc des budgets d'un track (§5.13), et n'invente rien.

- **Le dépliage est porté par la CELLULE qui compte les occurrences**, devenue un `button` avec
  `aria-expanded` — patron du §5.13, où le dépliage est « un `button` portant `aria-expanded`,
  distinct de tout autre élément interactif de la ligne ». La cellule reste alignée à droite et garde
  la hauteur `--size-target` : le nombre ne bouge pas en devenant cliquable. Sur un budget **non
  récurrent** elle reste un texte inerte, aucune occurrence n'y étant possible.

- **Le contenu déplié vit SOUS la table, jamais dans une ligne de celle-ci.** ~~Le contenu déplié est
  une ligne de table à part entière, `<tr>` portant une `<td colSpan>` sous la ligne du budget.~~
  **RÉVISÉ le 2026-08-28, dans le même changement que le code, et le motif est écrit ici plutôt que
  tu :** la première rédaction de ce point a été faite avant relecture de `BlocBudgetsTrack.tsx`, qui
  porte depuis `CRM-084` tranche 2 une décision contraire et motivée — « un `form` inséré dans un
  `tr` casserait le modèle de tableau, et un `td` qui s'étend sur sept colonnes ferait sauter
  l'alignement que le §5.9 existe pour tenir ». Les trois surfaces déjà rendues par ce bloc — création,
  édition, confirmation de clôture — vivent donc sous la table, et faire autrement pour la quatrième
  aurait donné **deux placements** pour un même type de surface dans un même bloc. La sous-surface
  suit la règle du bloc qui l'accueille. Reste inchangé ce que cette règle protégeait : elle vit
  **dans le flux du document**, jamais en surface flottante (§5.13, « aucune modale »), une liste
  ancrée demandant un piège de focus et une gestion d'`Échap` qu'aucune unité n'a spécifiés.

- **Le budget concerné est NOMMÉ en tête de la sous-surface**, conséquence directe du point
  ci-dessus : détachée de la ligne qui l'a ouverte, elle doit dire de quel budget elle parle. Un
  panneau anonyme sous une table de dix budgets ferait remonter l'œil chercher lequel est déplié.

- **La liste des occurrences est une `ul` / `li`, pas un second tableau.** Le §5.9 régit un tableau de
  données comparables ; imbriquer une table dans une cellule de table donnerait deux grilles de
  colonnes désalignées, que l'œil lit comme un défaut de rendu. Hauteurs de ligne, séparateurs et
  survol du §5.9 — `--size-target`, bordure basse `--color-border`, `--color-hover`, aucune zébrure.

- **L'état d'une occurrence est un MOT** — « Ouverte », « Clôturée » —, jamais une teinte ni une
  opacité seules (§1, et §5.13 pour « Archivé »). La ligne close garde la même hauteur et le même
  contraste : une ligne grisée se lirait comme une panne d'affichage.

- **Le groupe d'actions est la barre de boutons discrets compacts du §5.13**, toujours visible, avec
  trois commandes et **trois icônes Lucide distinctes** : `Pencil` (renommer et doter), `Lock` /
  `LockOpen` (clôturer, rouvrir) et `Trash2` (retirer). Clôturer et rouvrir sont **deux icônes**,
  jamais la même retournée — le §5.13 a déjà tranché ce cas pour l'archivage. **Aucune icône
  nouvelle** : les quatre servent déjà ailleurs (§9).

- **Un seul élément ouvert à la fois dans le bloc**, occurrences comprises : déplier une ligne ferme
  le formulaire de budget en cours, et ouvrir un formulaire d'occurrence ferme le précédent. C'est
  l'union `Ouverture` du §5.13, étendue et non doublée — deux états concurrents laisseraient deux
  formulaires ouverts sur une même ligne.

- **Ouvrir un formulaire déplace le focus dans son premier champ ; le fermer le rend à la commande
  qui l'a ouvert** (§5.13). Le retour de focus passe par un effet, jamais par le gestionnaire
  d'annulation : au moment où celui-ci s'exécute, la commande qui a ouvert le formulaire n'existe pas
  encore dans le document et la référence vaut `null` — défaut mesuré et corrigé à `CRM-055`
  tranche 2 (décision 537, point 2).

- **Le retrait porte une confirmation dans le flux, distincte du formulaire** (§5.13) : sa propre
  question, son propre corps, et le nom de l'occurrence visé. La clôture et la réouverture n'en ont
  **pas** — elles se défont d'un clic, et le §5.13 réserve la confirmation à ce qui ne se défait pas
  ainsi.

- **Le refus est une alerte `--color-danger-soft` / `--color-danger-on-soft` avec `role="alert"`,
  placée DANS le formulaire concerné**, jamais en tête de bloc : le refus se lit près du champ qui
  l'a causé (§5.13). Le dictionnaire est fermé, `docs/SPEC-costs.md` §4.1 bis.4.

- **Les quatre états du §5.8 sont traités pour la liste elle-même** : en chargement, en erreur, la
  liste, et **« aucune occurrence » — qui n'est pas un état vide en défaut** mais l'invitation au
  seul geste qui vaille, la commande « Ouvrir une occurrence » restant offerte dans les quatre.

- **DEUX DÉFAUTS TROUVÉS PAR L'ŒIL À 390 px, ET AUCUNE ASSERTION NE LES ATTRAPAIT** (`CLAUDE.md`
  §16). Ils sont consignés ici parce qu'ils tiennent à la FORME, et que la règle qui en sort vaut
  au-delà de cette sous-surface.

  - **Le libellé — la donnée qui NOMME la ligne — sortait du cadre par la GAUCHE.** La commande de
    dépliage vit dans la cellule des occurrences, tout à droite d'une table plus large que la
    fenêtre ; la cliquer fait défiler horizontalement le conteneur de l'arborescence, et la
    sous-surface, rendue sous la table dans ce même conteneur, naissait décalée de **266 px**. La
    capture montrait « du 2026-02-01 au 2026-02-28 2500 Ouverte » **sans** « Février 2026 ». La
    ligne de base du §2.4 l'établit comme nôtre : la capture des budgets au même palier, prise avant
    cette tranche, ne défile pas. **Deux corrections, pas une** : le libellé occupe sa propre ligne
    sous `md`, et la sous-surface se ramène dans le cadre à son ouverture. **`scrollIntoView` doit
    employer `inline: 'start'` et non `'nearest'`** — mesuré : la boîte de contenu du conteneur vaut
    846 px là où la fenêtre en montre 358, la surface est donc plus large que la zone visible, et
    `'nearest'` juge qu'elle est déjà en vue puisqu'elle couvre tout le cadre.
  - **Un montant nu dans une `ul` ne dit pas de quoi il est le nombre.** La table des budgets a une
    colonne « Enveloppe » pour le dire ; une liste sans en-têtes n'a rien. Le montant porte donc un
    libellé `sr-only`, et reste visuellement le seul texte.

  **La règle qui en sort, et qui vaut pour toute surface rendue sous une table plus large que la
  fenêtre** : l'assertion de palier qui porte sur la PAGE ne voit pas un conteneur INTERNE qui
  défile. Une preuve de palier doit mesurer le cadre de la surface elle-même et **nommer le
  coupable par sa coordonnée**, faute de quoi elle est verte sur un écran illisible.

- **Aucune couleur et aucun jeton nouveaux** : la sous-surface emprunte au §5.13 sa barre d'actions,
  ses formulaires dans le flux et sa confirmation, au §5.9 ses hauteurs et ses séparateurs, au §5.7
  ses champs et au §5.8 ses états.

### 5.48 Tableau de pilotage — `CRM-066` tranche 3

`docs/SPEC-analytique.md` §7 et §8 disent ce que l'écran **lit** et ce qu'il **calcule** ; les règles
ci-dessous ne disent que de quoi il a l'air. Le §8 laissait **délibérément** la forme de l'entonnoir,
ses composants, ses paliers, son parcours clavier et ses états à cette tranche, « écrits dans
`docs/DESIGN_SYSTEM.md` **avant** sa première ligne de code ». Les voici.

**TROIS BLOCS, DANS CET ORDRE : les deux grandeurs, l'entonnoir, les mentions.** On lit ce qu'on
**espère** avant de lire **d'où** cela vient — le même ordre que la fiche de budget (§5.32), dont
l'identité précède l'histogramme et le détail ligne à ligne.

- **LES DEUX GRANDEURS SONT UNE LISTE DE DÉFINITIONS (`dl`), PAS UN TABLEAU** (§5.20, §5.32). Le
  prévisionnel pondéré et le taux de conversion sont deux couples terme / valeur qui **ne se
  comparent pas entre eux** : l'un est de l'argent, l'autre une proportion. Deux colonnes à partir
  de `md`, empilées en dessous — `md` et **jamais `sm`**, qui est un variant inconnu que Tailwind
  supprime en silence (§11, §5.20).

- **LE PRÉVISIONNEL REND UNE VALEUR PAR DEVISE, ET AUCUN TOTAL** (`docs/SPEC-analytique.md` §11.2).
  Chaque montant est une **donnée technique** (§2) — monospace, chiffres tabulaires — et son code
  devise occupe **son propre élément**, jamais un nœud de texte accolé au nombre : c'est le défaut
  « Discussion1 » du §5.11, dont le remède est écrit une fois pour tout le produit. **Une devise dont
  toutes les affaires sont closes n'apparaît pas** : « CHF : 0,00 » se lirait comme une prévision
  nulle au lieu d'une absence de prévision, et le module le garantit déjà.

- **LE TAUX PORTE SON NOM ENTIER — « Taux de conversion des affaires décidées » —, jamais « taux de
  conversion » tout court.** Le nom est la moitié de la règle : ce nombre mesure la part gagnée parmi
  les affaires **actuellement** à un nœud terminal, et non parmi les affaires entrées dans une
  période (`docs/SPEC-analytique.md` §7.1, §11.1). L'abréger à l'écran ferait dire au produit ce
  qu'il ne mesure pas.

- **ZÉRO AFFAIRE DÉCIDÉE REND UNE PHRASE, JAMAIS « 0 % ».** Un taux de 0 % dit « tout a été perdu » ;
  l'absence de toute décision ne dit rien. C'est la distinction « ne se prononce pas » / « vaut
  zéro » que le §5.18 tient pour un attribut de nœud et le §5.32 pour une enveloppe non renseignée.

- **LE TAUX EST ACCOMPAGNÉ DE SON NUMÉRATEUR ET DE SON DÉNOMINATEUR, EN TOUTES LETTRES** — « 7
  gagnées sur 8 décidées », en 13 px `--color-text-2` sous la valeur. Un pourcentage nu ne dit pas
  sur combien il porte : c'est le « chiffre qui ne dit pas ce qu'il compte » que le §5.36 refuse
  pour un badge, et **l'accord se fait par clé** (§10).

- **L'ENTONNOIR EST UN TABLEAU DU §5.9, ET NON LA LISTE PLATE DU §5.18.** Le critère est celui que le
  §5.19 applique déjà au carnet : les colonnes — nœud, genre, affaires, montant, pondéré — sont les
  **mêmes** pour chaque ligne et **se comparent** d'un nœud à l'autre, ce qui est exactement la
  lecture qu'on vient faire ici. En-tête collant, séparateurs de lignes, aucune zébrure, survol
  `--color-hover` : le §5.9 sans écart.

- **UN TABLEAU PAR DEVISE, ET SON TITRE `h2` N'EST RENDU QUE S'IL Y EN A PLUSIEURS** — la règle du
  §5.33, reprise sans changement et pour son motif exact. Deux tableaux empilés avec les mêmes
  en-têtes de colonne ne diraient pas à l'œil que le second compte des francs : la devise ne se
  lirait que dans les montants, c'est-à-dire là où on ne la cherche pas. Sur une seule devise — le
  cas attendu — le titre serait du bruit à chaque ouverture.

- **L'ORDRE DES LIGNES EST CELUI DU CATALOGUE, ET AUCUNE COLONNE N'EST TRIABLE.** C'est l'écart
  assumé avec le §5.9, qui déclare le tri d'une colonne triable : **un entonnoir est un chemin**, et
  le reclasser par montant en ferait un palmarès, où « Perdu » remonterait au-dessus de
  « Prospection ». L'ordre vient de `workflow_nodes_catalog.position`, donc de la même autorité que
  l'ordre du board (§5.2).

- **LE GENRE DU NŒUD EST UN MOT, JAMAIS UNE TEINTE** (§1) — « Ouvert », « Gagné », « Perdu » —, et ce
  sont **les mots exacts du §5.18** : c'est la même donnée, `workflow_nodes_catalog.kind`, et deux
  écrans qui la rendent ne peuvent pas la nommer de deux façons. Il n'est pas décoratif : c'est lui,
  et lui seul, qui dit pourquoi la ligne « Livré » ne figure **pas** dans le prévisionnel de la tête
  d'écran.

- **LE LIBELLÉ DU NŒUD EST UN `th scope="row"` ALIGNÉ À GAUCHE EXPLICITEMENT.** C'est la règle
  générale que le §5.30 a payée en regardant une capture : un `th` est **centré par défaut**, et
  l'alignement s'écrit sur la cellule, il ne s'hérite pas de la ligne d'en-tête.

- **LES TROIS NOMBRES SONT DES DONNÉES TECHNIQUES ALIGNÉES À DROITE** (§2, §5.9) : monospace,
  chiffres tabulaires. C'est la seule raison d'avoir des chiffres tabulaires — se comparer colonne
  par colonne.

- **LES DEUX EN-TÊTES DE MONTANT NOMMENT LA DEVISE — « Montant (EUR) » —, ET C'EST UN DÉFAUT TROUVÉ
  EN REGARDANT UNE CAPTURE** (`CLAUDE.md` §16, 2026-08-30). Le titre `h2` ci-dessus n'est rendu que
  s'il y a **plusieurs** devises ; sur une devise unique — le cas attendu, celui que l'utilisateur
  voit tous les jours — plus rien à l'œil ne disait de quelle monnaie ces nombres sont, hors le
  prévisionnel d'un bloc plus haut. C'est exactement le « montant nu dans une liste sans en-têtes »
  que `docs/SPEC-analytique.md` §7.3 refuse, transposé au tableau. **La règle générale, réemployable :
  quand un titre de regroupement est conditionnel, ce qu'il qualifie doit être nommé ailleurs de
  façon INCONDITIONNELLE** — sans quoi le cas majoritaire est précisément celui qui perd
  l'information.

- **AUCUN LIEN, ET L'ABSENCE EST ASSUMÉE.** C'est l'écart avec le §5.33, dont chaque libellé de
  track mène à ses coûts : un **nœud** n'est pas adressable — aucun écran du produit ne liste « les
  affaires de ce nœud », toutes portées confondues —, et un lien vers une adresse qui n'existe pas
  serait la commande morte du §5.10. Le §5.33 posait ce lien parce que sans lui son écran était une
  impasse ; ici il n'y a pas d'issue à offrir, et en inventer une serait pire.

- **LES DEUX MENTIONS OBLIGATOIRES VIVENT SOUS LES TABLEAUX**, en 13 px `--color-text-2`, à la place
  et dans la graduation de la mention du §5.30 — « *n* lignes sans coût réel saisi » —, qui est de la
  même nature. `docs/SPEC-analytique.md` §7.3 les impose : « *n* affaires sans montant » et « *n*
  affaires sans probabilité ». Sans elles, un prévisionnel bas se lit comme un portefeuille **pauvre**
  au lieu d'un portefeuille **mal renseigné**.

  - **Chacune n'est rendue que si son compte est non nul.** « 0 affaire sans montant » est une
    phrase qui ne dit rien, et le §5.31 a déjà tranché ce cas pour son badge.
  - **Elles TRAVERSENT LES DEVISES, et c'est licite** : ce sont des **affaires**, pas de l'argent.
    C'est exactement le motif pour lequel le module fait traverser les devises au seul compte des
    affaires décidées — il n'additionne aucune monnaie.
  - **L'accord se fait par clé** (§10), jamais par un gabarit paramétré : « les 1 affaires » est
    faux.

- **LA PORTÉE DU CALCUL EST ÉCRITE SOUS LES MENTIONS**, même place, même graduation et même motif
  qu'au §5.33 : l'entonnoir est calculé **après** la RLS (`docs/SPEC-analytique.md` §5.3), et deux
  profils lisent donc deux nombres différents sur les mêmes données — mesuré, 381 042,50 EUR contre
  344 892,50. Sans cette phrase, l'écart se lirait comme une erreur de calcul, et quelqu'un finirait
  par « corriger » la lecture. **Elle n'est pas rendue sur l'état vide**, où il n'y a aucun nombre à
  qualifier.

- **L'ÉCRAN NE NOMME JAMAIS CE QU'IL NE MONTRE PAS.** Aucune phrase ne dit « une affaire vous est
  masquée », et l'état vide ne distingue pas « aucune affaire lisible » de « aucune affaire active » :
  les deux divulgueraient par la bande ce que la RLS ferme (`docs/SPEC-permissions-rls.md` §7). C'est
  la règle que le cumul des coûts (§5.33), le canevas d'objectifs (§5.29) et les affaires figées
  (§5.37) tiennent déjà.

- **LES ÉTATS DU §5.8, ET LE REFUS N'EST PAS DÉGUISÉ EN VIDE.** Chargement : squelette à la forme du
  tableau attendu, jamais un spinner. Erreur : la mention et son **action de reprise**, qui relit
  réellement. **Refus** : la fonction est refusée à l'anonyme **par le privilège**
  (`docs/SPEC-analytique.md` §5.4), donc `401` et non zéro ligne ; l'écran l'écrit, et masquer un
  `401` en « aucune affaire » ferait lire une absence de **droit** comme un portefeuille vide.
  **Vide** : « aucune affaire active », **sans action** — l'écart au §5.8 que la corbeille (§5.16),
  le carnet (§5.19), les affaires figées (§5.37) et le panneau de notifications (§5.43) prennent
  déjà : une affaire se crée depuis un board, que cet écran ne connaît pas, et y renvoyer
  conditionnellement au rôle ferait calculer un droit à l'interface (`CLAUDE.md` §10). **Aucun espace
  de travail** : l'état que le §5.33 nomme déjà, et pour son motif — laisser le squelette serait la
  page blanche déguisée que le §5.8 refuse.

- **AUCUNE COMMANDE D'ÉCRITURE, ET L'ABSENCE EST ASSUMÉE** — la règle du §5.36 et du §5.37, tenue
  sans changement. Cet écran **mesure**, il n'agit pas (§5.14). Les trois colonnes de probabilité se
  saisissent au catalogue (§5.18), dans l'éditeur de workflows (§5.15) et dans la fiche d'affaire
  (§5.3 ter) ; un second chemin d'écriture ici en ferait une seconde définition du même geste.

- **LE PARCOURS CLAVIER EST CELUI D'UNE LECTURE, ET C'EST UNE PROPRIÉTÉ, PAS UN MANQUE.** La seule
  cible interactive de l'écran est l'**action de reprise** de l'état d'erreur, qui suit le §5.5 —
  40 px, anneau de focus `--color-brand`. Un tableau sans tri, sans lien et sans commande n'a aucun
  autre point d'entrée à offrir, et lui en inventer un violerait la règle ci-dessus. Les deux
  tableaux restent atteignables par les points de repère sémantiques du §8.

- **SOUS LES PALIERS ÉTROITS, LES TABLEAUX DÉFILENT DANS LEUR CONTENEUR**, qui porte
  `.indique-debordement-x` (§12.6) — la règle du §5.19, du §5.20 et du §5.24. Aucun `scroll-snap`,
  faute de colonne sur laquelle s'ancrer (§5.9). **La page ne défile jamais horizontalement** (§7),
  et c'est mesuré aux quatre paliers.

- **L'ENTRÉE DE BARRE LATÉRALE PORTE `Gauge`, ET ELLE SUIT IMMÉDIATEMENT « Coûts ».** Les deux
  écrans sont les deux lectures **agrégées** du portefeuille — ce qu'il a coûté, ce qu'il peut
  rapporter — et se lisent dans cet ordre ; « Ma journée » et « Affaires figées », qui les suivent,
  répondent à une autre question, « qu'est-ce qui me réclame ? ». Ce n'est pas une commodité de
  rangement, c'est le même raisonnement que le §5.37 a écrit pour sa propre place. `Gauge` ne sert
  nulle part ailleurs (§9) : elle dit l'**instrument qui mesure**, là où `ChartColumn` dit la
  comparaison de deux séries et `Goal` le but atteint. Comme le carnet, les objectifs, les coûts,
  « Ma journée » et les affaires figées, c'est une route de **premier niveau** et non une section de
  `/reglages` : un tableau de pilotage n'administre rien, il porte le travail.

- **AUCUNE COULEUR, AUCUN JETON NOUVEAU** : l'écran emprunte au §5.9 son tableau, au §5.20 sa liste
  de définitions, au §5.33 son titre de devise et sa phrase de portée, au §5.30 la graduation de ses
  mentions, au §5.5 son bouton de reprise et au §5.8 ses états. **Une seule icône Lucide nouvelle —
  `Gauge`.**

**CE QUE LA TRANCHE 3 a NE LIVRE PAS, ET QUI EST NOMMÉ PLUTÔT QUE TU** (`docs/SPEC-analytique.md`
§10) :

- **le sélecteur de portée** — track, channel — que le §8 annonce dans la chaîne de requête. Le
  module le porte déjà (`restreindre`, éprouvé), mais l'offrir demande de **nommer** les tracks et
  les channels, donc une seconde lecture que cette tranche ne fait pas. L'écran rend donc la portée
  **workspace**, et sa phrase de portée le dit en toutes lettres ;
- **la complétion par le catalogue** — le §5.1 de la spécification écrit que l'écran « compose la
  liste complète des nœuds depuis `workflow_nodes_catalog` […] et affiche zéro là où la fonction se
  tait ». Elle demande la même seconde lecture, et elle pose en outre une question que le §5.1 ne
  tranche pas : compléter **dans le tableau d'une devise** inventerait une devise à un nœud
  qu'aucune affaire n'y porte, ce que ce même §5.1 interdit à la fonction. La tranche 3 b tranchera
  la forme avant de l'écrire. Un nœud sans aucune affaire active est donc, aujourd'hui, **absent**
  des tableaux — jamais rendu à zéro, ce qui serait pire : le zéro affirmerait une mesure que
  l'écran n'a pas faite.
