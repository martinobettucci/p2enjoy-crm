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
- **Onglets** : les channels du track courant. Débordement horizontal défilable, jamais tronqué
  sans indication.
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

### 5.2 Colonne de board

En-tête collant, fond `--color-bg`, compteur en badge neutre. Zone de dépôt signalée par un
liseré `--color-brand` en pointillés pendant le glissement. État vide : message et action
(« Aucune card à cette étape — créez la première »).

### 5.3 Détail de card

Deux colonnes sur grand écran, empilées sous 1024 px :
- à gauche, le **formulaire conditionnel** (voir `docs/SPEC-form-composer.md`) et les champs
  d'entête (titre, responsable, montant, prochaine action) ;
- à droite, la **timeline unifiée** : commentaires, transitions, activités, emails, pièces
  jointes, dans un fil chronologique unique avec filtres par type.

L'adresse email de la card est affichée en monospace, avec une action de copie et une infobulle
expliquant son usage.

### 5.4 Inbox

Trois panneaux : dossiers (arborescence Track → Channel → Card, plus « Non classés »), liste des
messages, message affiché. Sous 1024 px, navigation par pile : dossiers → liste → message.

Un message classé affiche la card à laquelle il appartient sous forme de pilule cliquable. Un
message non classé affiche l'action « Classer dans une card » et, le cas échéant, la suggestion
proposée par le classement assisté, toujours présentée **comme une suggestion à confirmer**.

### 5.5 Boutons

| Variante | Style |
|---|---|
| Primaire | Fond `--color-brand`, texte blanc, `--radius-sm`, survol `--color-brand-hover` |
| Secondaire | Fond blanc, bordure `--color-border`, survol `--color-hover` |
| Destructif | Rouge, plein ou contour, toujours séparé des actions primaires |
| Discret | Texte seul, réservé aux actions tertiaires |

Hauteur minimale 40 px. Anneau de focus 2 px `--color-brand` avec décalage.

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

`rounded-full`, fond de la couleur à 10–15 %, texte à la couleur pleine, **précédés d'un point
ou d'une icône** afin que l'information ne repose jamais sur la seule couleur.

### 5.7 Champs de formulaire

Libellé au-dessus, 13 px, `--color-text-2`. Champ 40 px de haut, bordure `--color-border`,
focus `--color-brand`. Texte d'aide sous le champ en 13 px `--color-text-3`. Erreur en
`--color-danger` avec icône, `role="alert"`, associée au champ par `aria-describedby`.

Un champ **obligatoire pour la transition en cours** est signalé par un astérisque et la mention
« requis pour passer à <étape> » — l'utilisateur doit comprendre *pourquoi* il est requis.

### 5.8 États systématiques

Toute vue traite explicitement : chargement (squelettes, pas de spinner plein écran), vide
(message et action), erreur (message compréhensible et action de reprise), et absence de droit
(explication, pas une page blanche).

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

## 10. Internationalisation

Aucun texte visible n'est écrit en dur dans un composant : tout passe par des clés de traduction
stables. Langue par défaut : français. Les libellés métier (tracks, channels, nœuds, champs) sont
des **données**, pas des traductions. Les mises en page tolèrent des textes 40 % plus longs que
le français.

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

### 12.1 Barre d'onglets sans patron `tablist` — temporaire, `CRM-007`

Tant qu'aucun channel n'existe (`CRM-021`), la barre d'onglets affiche son **état vide** au lieu
d'un `tablist` sans onglet : un `tablist` vide est annoncé par les lecteurs d'écran comme un groupe
d'onglets, c'est-à-dire comme une interface qui n'existe pas. Le patron ARIA complet — `role="tab"`,
`tabindex` glissant, flèches, `Home`, `Fin` — arrive avec les onglets réels et leurs preuves.

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

### 12.4 Pilules de track non cliquables — temporaire, `CRM-020`

La barre latérale liste les tracks (§4), mais chaque pilule est un élément de liste, non un lien.
Un track s'ouvre sur ses **channels**, livrés par `CRM-021` : une pilule menant à une route vide
serait une commande morte, ce que le §8 interdit — un élément indisponible doit expliquer pourquoi,
pas feindre d'agir. Le lien arrivera avec la destination.

### 12.5 Aucune donnée métier n'est visible dans l'interface — `CRM-020`

Constat, et non choix de conception. La webapp n'a aucun parcours de connexion
(`docs/INCONSISTENCY_REPORT.md`, INC-021) : son client est anonyme, et les politiques RLS ne
consentent aucune ligne à un anonyme. Les captures de référence montrent donc l'**état vide**, qui
est le refus réel du backend.

Conséquence pour toute revue d'interface à venir : une capture vide ne prouve pas un défaut
d'interface tant que cet arbitrage n'est pas rendu, et le rendu chargé se vérifie par test
unitaire du composant réel (`webapp/src/app/SectionTracks.test.tsx`) ou en substituant la réponse
réseau — jamais en injectant un état interne.

Tout écart futur est consigné ici avec sa justification et sa date.
