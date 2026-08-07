# Spécification — squelette de la webapp

Unité de backlog : `CRM-007` (`docs/BACKLOG.md`). Documents liés : `docs/DESIGN_SYSTEM.md`
(référence maîtresse de l'interface), `docs/DAT.md` §3.1 (composant `webapp`), §9 (déploiement),
§13 (commandes), `docs/SPEC-types.md` (types générés consommés ici), `README.md` §5, §7, §8, §10.

Ce document est écrit **après mesure** de la chaîne d'outils réellement installée, et non de
mémoire. Chaque version citée au §2 a été installée et exercée avant la rédaction. Il est écrit et
committé **avant toute ligne de code applicatif**, conformément à `CLAUDE.md` §5.

---

## 1. Objet et périmètre

`CRM-007` livre le **squelette** de l'interface : la chaîne de build, les jetons du design system,
la coquille de navigation (barre latérale et onglets), et le traitement explicite des états de
chargement, d'erreur, de vide et d'absence de droit. Il ne livre **aucune fonctionnalité métier**.

### 1.1 Dans le périmètre

| Élément | Motif |
|---|---|
| Chaîne Vite + React + TypeScript + Tailwind | `docs/BACKLOG.md`, `CRM-007` |
| Jetons du design system en variables CSS | `docs/DESIGN_SYSTEM.md` §11 |
| Coquille : barre latérale, en-tête, barre d'onglets, zone principale | `docs/DESIGN_SYSTEM.md` §4 |
| États systématiques : chargement, vide, erreur, absence de droit | `docs/DESIGN_SYSTEM.md` §5.8 |
| Routes de premier niveau | `docs/DAT.md` §3.1 (« routes … relève de `CRM-007` ») |
| Client Supabase | `docs/DAT.md` §3.1 (« client Supabase … relève de `CRM-007` ») |
| Dictionnaire de traduction et fonction `t` | `docs/DESIGN_SYSTEM.md` §10 |
| Service `webapp` de l'overlay de développement | `runDev.sh` l'annonce déjà comme dû à `CRM-007` |
| Build de production vers `webapp/dist`, servi par Caddy | `docker-compose.prod.yml`, `README.md` §8 |
| Reprise de la preuve de build due à `CRM-006` | `docs/INCONSISTENCY_REPORT.md`, INC-020 |

### 1.2 Hors périmètre, et nommé comme tel

| Élément | Unité qui le porte |
|---|---|
| Écran de connexion et parcours d'authentification | aucune unité à ce jour — voir §15 |
| Tracks en barre latérale (données réelles) | `CRM-020` |
| Onglets de channels (données réelles) | `CRM-021` |
| Board kanban, cards, détail de card | `CRM-030` → `CRM-047` |
| Inbox | `CRM-054` → `CRM-056` |
| Harnais de tests complet (`e2e:api`, `e2e:mail`, pytest) | `CRM-008` |

La coquille affiche donc, pour les tracks comme pour les channels, l'**état vide** prévu par
`docs/DESIGN_SYSTEM.md` §5.8. Ce n'est pas un écran inachevé : c'est l'état réel du produit tant
que `CRM-020` et `CRM-021` ne sont pas livrés, et il est traité explicitement.

## 2. Chaîne d'outils — versions mesurées

Mesures réalisées le 2026-08-04 dans l'environnement de vérification, avant rédaction.

| Paquet | Version épinglée | Mesure |
|---|---|---|
| `react`, `react-dom` | `19.2.8` | build et rendu exercés |
| `@types/react` | `19.2.18` | |
| `@types/react-dom` | `19.2.4` | |
| `vite` | `8.2.0` | `vite build` vert, 1 782 modules, 219 ms |
| `@vitejs/plugin-react` | `6.0.5` | JSX transformé, HMR non mesuré |
| `tailwindcss`, `@tailwindcss/vite` | `4.3.3` | jetons émis sur `:root,:host`, utilitaires en `var(--…)` |
| `react-router` | `8.3.0` | |
| `@supabase/supabase-js` | `2.112.0` | |
| `lucide-react` | `1.28.0` | icône rendue dans le build de mesure |
| `typescript` | `5.9.3` | conservé — voir §2.2 |
| `vitest` | `4.1.10` | suite jsdom verte sur un cas témoin |
| `jsdom` | `30.0.1` | |
| `@testing-library/react` | `16.3.2` | |
| `@playwright/test` | `1.62.1` | navigateur `chromium` build 1234 téléchargé, capture produite |

Les versions sont **épinglées exactement**, sans accent circonflexe, comme `typescript` l'était
déjà dans le `package.json` livré par `CRM-006`.

### 2.1 React 19 alors que `docs/DAT.md` §3.1 annonce React 18

`docs/DAT.md` §3.1 a été écrit avant qu'aucun code n'existe et nomme « React 18 ». La version
courante et maintenue est **19.2.8** ; `@vitejs/plugin-react` 6 et `@types/react` 19 sont alignés
sur elle. Livrer React 18 serait une régression délibérée sans motif technique.

**Décision : React 19.** `docs/DAT.md` §3.1 est corrigé dans le même changement, et la décision est
consignée dans `docs/JOURNAL.md`. Aucune contradiction n'est laissée ouverte : le document décrit
désormais ce qui est réellement livré.

### 2.2 TypeScript reste à `5.9.3`

`docs/JOURNAL.md` décision 39 demandait de réexaminer l'épinglage à `CRM-007`. Le réexamen a eu
lieu, **par la mesure** : `typescript@7.0.2` compile l'application sans erreur, à condition
d'ajouter `vite/client` aux types ambiants — sans quoi il refuse l'import à effet de bord d'une
feuille de style (`TS2882`), là où `5.9.3` l'accepte en silence.

**Décision : conserver `5.9.3` pour cette unité.** Motifs : les preuves de `CRM-006` reposent sur
le compilateur épinglé et une bascule les rejouerait toutes sans nécessité ; l'outillage de test et
de lint du cycle 5 est celui que Vitest et Playwright consomment aujourd'hui sans réserve. La
mesure est consignée : la migration est ouverte, elle n'est pas due par cette unité.

## 3. Emplacement, disposition et configuration

### 3.1 Arborescence

```
webapp/
├── index.html                 point d'entrée Vite
├── vite.config.ts             configuration de build et de développement
├── tsconfig.json              configuration TypeScript de l'application
├── tsconfig.test.json         configuration TypeScript des tests unitaires
├── Dockerfile                 image de développement (Vite)
├── dist/                      produit par `npm run build`, non versionné
└── src/
    ├── main.tsx               montage React
    ├── app/                   coquille : mise en page, routes, providers
    ├── components/ui/         composants du design system (seuls à porter des styles de base)
    ├── features/              vide à ce stade — accueillera les domaines métier
    ├── i18n/                  dictionnaire et fonction de traduction
    ├── lib/                   client Supabase, types générés, utilitaires d'accès aux données
    └── styles/tokens.css      **seul** fichier portant des valeurs hexadécimales
```

`src/features/` reste vide tant qu'aucun domaine métier n'est livré ; le répertoire n'est pas créé
par anticipation.

### 3.2 Un seul projet npm

Le dépôt conserve **un seul `package.json` et un seul `node_modules`, à la racine**. Vite est
invoqué avec `--config webapp/vite.config.ts`, et sa racine est **déclarée explicitement** dans
cette configuration (`root: import.meta.dirname`). Mesuré : `--config` ne déplace pas la racine,
qui reste le répertoire courant — sans `root`, le build échoue en `UNRESOLVED_ENTRY` faute de
trouver `index.html`, et Vitest ne trouve aucun test. Motif du projet unique : deux projets npm
imposeraient deux installations, deux verrous de dépendances et deux points de dérive, pour aucun
gain à cette échelle.

### 3.3 Quatre configurations TypeScript, quatre périmètres

| Fichier | Périmètre | Motif |
|---|---|---|
| `tsconfig.json` (racine) | les deux fichiers de types générés de `CRM-006` | `types: []`, aucune bibliothèque DOM : ces fichiers ne dépendent de rien |
| `webapp/tsconfig.json` | `webapp/src`, hors tests | JSX, `lib` DOM, `types: ["vite/client"]` |
| `webapp/tsconfig.test.json` | les tests unitaires | ils s'exécutent sous Node, avec un DOM simulé : ils ont besoin des deux |
| `tsconfig.tools.json` | configurations Vite/Vitest et scénarios E2E | Node **et** DOM : un pilote de navigateur vit à cheval sur les deux |

Deux périmètres, devenus quatre à la mesure : séparer les tests du code de l'application n'est pas
une commodité, c'est ce qui garde `process` et `node:fs` **interdits** dans un fichier destiné au
navigateur.

`webapp/tsconfig.json` porte `skipLibCheck: true`, seul relâchement du dépôt : `@supabase/storage-js`
et `@supabase/phoenix` déclarent `Buffer` et le namespace `NodeJS` dans leurs propres `.d.ts`.
L'alternative — ajouter `node` aux types ambiants de l'application — ferait entrer ces globales dans
du code de navigateur (`docs/JOURNAL.md` décision 45). Les trois autres projets conservent
`skipLibCheck: false`.

L'`include` de la configuration racine est **restreint aux deux fichiers générés** : il visait
auparavant `webapp/src/lib/**/*.ts`, ce qui aurait entraîné la compilation du client Supabase sous
une configuration dépourvue de types DOM. `docs/SPEC-types.md` §9 est mis à jour en conséquence.

`npm run typecheck` compile **les deux** projets. La garde de `CRM-006` — une assertion faussée
doit faire échouer `typecheck` — reste donc exacte, et s'étend à l'application.

## 4. Jetons du design system

`docs/DESIGN_SYSTEM.md` §11 impose : jetons déclarés **une seule fois** en variables CSS sur
`:root`, exposés à Tailwind par la configuration du thème, **aucun hexadécimal dans un composant**.

Tailwind 4 satisfait les deux exigences par un unique bloc `@theme` : il émet les variables sur
`:root,:host` — mesuré — et engendre des utilitaires qui les référencent
(`.bg-brand{background-color:var(--color-brand)}` — mesuré). Aucun fichier de configuration
JavaScript n'est donc nécessaire.

`webapp/src/styles/tokens.css` est le **seul** fichier du dépôt autorisé à contenir une valeur
hexadécimale. Il déclare exactement les jetons de `docs/DESIGN_SYSTEM.md` §1 à §3 :

| Jeton | Valeur | Source |
|---|---|---|
| `--color-brand` | `#23468C` | §1 |
| `--color-brand-hover` | `#1B3670` | §1 |
| `--color-brand-soft` | `#23468C` à 10 % | §1 |
| `--color-success` | `#238C33` | §1 |
| `--color-accent` | `#D9CF4A` | §1 |
| `--color-danger` | `#F24141` | §1 |
| `--color-ink` | `#0D0D0D` | §1 |
| `--color-bg` | `#F7F8FA` | §1 neutres |
| `--color-surface` | `#FFFFFF` | §1 neutres |
| `--color-border` | `#E5E7EB` | §1 neutres |
| `--color-text` | `#374151` | §2 corps |
| `--color-text-2` | `#4B5563` | §1 neutres |
| `--color-text-3` | `#6B7280` | §1 neutres |
| `--color-hover` | `#F3F4F6` | §1 neutres |
| `--radius-sm`, `--radius-md`, `--radius-lg` | 8, 10, 14 px | §3 |
| `--shadow-card` | `0 1px 3px rgb(0 0 0 / .06)` | §3 |
| Échelle d'espacement | 4, 8, 12, 16, 24, 32, 48 px | §3 |

Les déclinaisons douces sont exprimées en `color-mix` à partir du jeton plein : elles ne
réintroduisent aucune valeur hexadécimale.

**Preuve associée :** un contrôle du harnais parcourt `webapp/src` et échoue si une valeur
hexadécimale de couleur apparaît ailleurs que dans `tokens.css`.

## 5. Architecture applicative

### 5.1 Coquille

Conforme à `docs/DESIGN_SYSTEM.md` §4 :

```
┌──────────────┬───────────────────────────────────────────────┐
│ aside        │  header : fil d'Ariane · profil               │
│ (nav)        ├───────────────────────────────────────────────┤
│              │  barre d'onglets (channels)                   │
│ Tracks       ├───────────────────────────────────────────────┤
│ Inbox        │  main : contenu de la route                   │
│ Ma journée   │                                               │
│ Réglages     │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

- `aside` porte la barre latérale ; `nav` la navigation ; `main` le contenu ; en-têtes hiérarchisés
  sans saut de niveau (`docs/DESIGN_SYSTEM.md` §8).
- La barre latérale est **repliable**. L'état de repli est une préférence de **session**
  (`docs/DESIGN_SYSTEM.md` §4) — voir §11.
- La barre d'onglets liste les channels du track courant. Sans track ni channel, elle affiche son
  état vide plutôt que de disparaître : la structure de l'écran reste lisible.

### 5.2 Routes

| Chemin | Contenu à ce stade |
|---|---|
| `/` | Board — état vide : aucun track n'est encore livré |
| `/inbox` | État vide de l'inbox |
| `/ma-journee` | État vide de la journée |
| `/reglages` | Réglages — état vide, et rappel des sources de configuration |
| `/tracks/:slugTrack[/:slugChannel]` | Route d'un track et de ses onglets — `CRM-021`. Avec un channel ouvert, elle rend son **board kanban** — `CRM-041`, `docs/SPEC-workflow-engine.md` §7 |
| `/tracks/:slugTrack/:slugChannel/cards/:idCard` | Détail d'une card : son **formulaire conditionnel** — `CRM-037`. La card est désignée par son identifiant, `docs/SPEC-cards.md` ne lui donnant aucun slug |
| toute autre | Route inconnue, avec retour explicite vers `/` |

Chaque route rend l'un des composants d'état du §7 : aucune n'est une page blanche.

### 5.3 Composants du design system livrés

Dans `webapp/src/components/ui`, seuls porteurs de styles de base
(`docs/DESIGN_SYSTEM.md` §11) :

`Button` (§5.5, quatre variantes), `Badge` (§5.6, point ou icône obligatoire), `Card` (§3),
`Skeleton` (§5.8), `EmptyState` (§5.8), `ErrorState` (§5.8), `ForbiddenState` (§5.8),
`LiveRegion` (§8, annonces `aria-live` polies), `SkipLink` (§8).

## 6. Accès aux données

### 6.1 Client

`webapp/src/lib/supabase.ts` crée le client `@supabase/supabase-js` typé par
`Database` (`webapp/src/lib/database.types.ts`, `CRM-006`). Deux variables d'environnement, lues
par Vite au build :

| Variable | Rôle | Obligatoire |
|---|---|---|
| `VITE_SUPABASE_URL` | URL publique de la passerelle Kong | oui |
| `VITE_SUPABASE_ANON_KEY` | Clé anonyme, publique par construction | oui |

Absentes, le client n'est pas construit et l'application affiche son **état d'erreur de
configuration** — elle ne démarre pas dans un état muet.

### 6.2 Session

`CRM-007` n'a livré aucun parcours de connexion et a donc créé le client avec
`persistSession: false` et `autoRefreshToken: false`. `CRM-011` porte désormais le contrat qui
succède à cette posture provisoire (`docs/SPEC-auth.md` §9) : session dans **`sessionStorage`**,
rafraîchissement automatique actif, et repli en mémoire si le stockage de l'onglet est
indisponible. Aucun `localStorage`, cookie non essentiel ni traceur n'est introduit.

La restauration de cette session précède les lectures du §6.3. L'état du routeur peut retenir
l'adresse métier demandée pendant le passage par `/connexion`, mais cette adresse n'est jamais
persistée et ne peut pas désigner une origine externe.

### 6.3 Ce que la coquille lit

La coquille lit `public.workspaces` pour nommer le contexte courant, et — depuis `CRM-020` —
`public.tracks` pour remplir la barre latérale (`docs/SPEC-tracks.md` §7). **Mesuré, hors
interface :**

| Appelant | Réponse | En base |
|---|---|---|
| clé anonyme | `200` et `[]` | 1 ligne |
| jeton réel d'un compte seedé, obtenu par la véritable route de connexion | `200` et `[]` | 1 ligne |

Les deux appelants obtiennent le même vide, alors que la ligne existe. Ce n'est pas l'absence de
session qui vide l'écran : **aucune politique RLS n'est écrite sur `workspaces`** — elles relèvent
de `CRM-012` — et le refus par défaut de `CRM-003` s'applique donc à tout le monde.

`tracks` est le premier cas différent : `CRM-020` a livré ses politiques, et un membre du workspace
y lit ses tracks. Depuis la reprise de `CRM-011`, la webapp restaure sa session avant les lectures
et montre donc les objets métier consentis. L'état vide reste l'état réel du backend pour un
anonyme. Les tables d'identité, elles, restent vides même connecté tant qu'INC-014 n'est pas levée.

L'interface n'en déduit **aucun droit** : `docs/DAT.md` §3.1 et `docs/SPEC-types.md` posent qu'un
type ne décrit jamais une autorisation. Ce que la coquille affiche est ce que le backend a
consenti à rendre.

### 6.4 Contrat asynchrone

Un type somme unique décrit tout chargement :

```ts
type AsyncState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly error: DataError }
```

`DataError` distingue `'forbidden'` (l'appel a été refusé), `'network'` (le backend est
injoignable) et `'unknown'`. Le rendu d'un état est **exhaustif** : le compilateur refuse un cas
non traité. Aucune valeur par défaut trompeuse ne masque une erreur (`CLAUDE.md` §18).

## 7. États systématiques

`docs/DESIGN_SYSTEM.md` §5.8 impose quatre traitements explicites.

| État | Rendu | Déclencheur réel |
|---|---|---|
| Chargement | squelettes à la forme du contenu attendu, jamais de spinner plein écran | requête en vol |
| Vide | message et action | `200` et zéro ligne |
| Erreur | message compréhensible, cause distinguée, action de reprise | requête en échec |
| Absence de droit | explication, pas de page blanche | refus identifié comme tel |

L'action de reprise **relance réellement** la requête ; elle ne recharge pas la page.

## 8. Responsive

Les quatre paliers de `docs/DESIGN_SYSTEM.md` §7 sont implémentés :

| Palier | Comportement livré |
|---|---|
| ≥ 1280 px | barre latérale déployée |
| 1024–1279 px | barre latérale réduite aux icônes, libellés en infobulle accessible |
| 768–1023 px | barre latérale en tiroir, ouverte par un bouton de l'en-tête |
| < 768 px | navigation par tiroir, contenu en une colonne |

La page **ne défile jamais horizontalement** : la barre d'onglets et les futures zones larges
défilent dans leur propre conteneur. Un contrôle E2E mesure la largeur de défilement du document à
chacun des quatre paliers.

## 9. Accessibilité et clavier

- Lien d'évitement en premier élément focusable, menant à `main`.
- Points de repère `aside`, `nav`, `main`, `header`.
- Anneau de focus 2 px `--color-brand` avec décalage, via `:focus-visible`, **partout**.
- Cibles interactives ≥ 40 px (`docs/DESIGN_SYSTEM.md` §5.5, §8).
- Barre d'onglets : sans channel — ils relèvent de `CRM-021` — elle expose son **état vide**
  plutôt qu'un `tablist` sans onglet, qu'un lecteur d'écran annoncerait comme un groupe d'onglets
  inexistant. Le patron ARIA complet (`role="tab"`, `tabindex` glissant, flèches, `Home`, `Fin`)
  arrive avec les onglets réels et leurs preuves : l'écrire aujourd'hui produirait du code
  qu'aucun test ne pourrait exercer.
- Région `aria-live="polite"` unique, alimentée par les changements importants.
- États désactivés lisibles, avec la raison de l'indisponibilité.
- `prefers-reduced-motion` respecté : les transitions sont neutralisées.

**Preuve associée :** un scénario E2E parcourt l'application **au clavier seul**, du lien
d'évitement jusqu'au contenu, et vérifie à chaque étape l'élément réellement focalisé.

## 10. Internationalisation

`docs/DESIGN_SYSTEM.md` §10 : aucun texte visible en dur, clés stables, français par défaut.

Le dictionnaire est un objet TypeScript figé, `webapp/src/i18n/fr.ts` ; la fonction `t` n'accepte
que les clés de ce dictionnaire — une clé inconnue **ne compile pas**. Aucune dépendance
d'internationalisation n'est ajoutée : le besoin d'aujourd'hui est un dictionnaire et une fonction
de recherche, et une bibliothèque introduirait un format de messages sans usage à ce stade. La
question du pluriel, des dates et des nombres se posera avec la première donnée réelle ; elle est
nommée en §15 plutôt qu'anticipée.

Les mises en page tolèrent des textes 40 % plus longs (§10 du design system) : les libellés de la
barre latérale et des onglets s'ellipsent avec leur texte complet en `title`.

**Preuve associée :** un contrôle du harnais échoue si un composant contient du texte visible écrit
en dur, et un test unitaire échoue si le dictionnaire contient une clé morte.

## 11. Stockage côté client

`CLAUDE.md` §11 borne le stockage sur l'appareil. L'unité n'écrit **rien** en `localStorage` :

| Donnée | Support | Catégorie |
|---|---|---|
| Repli de la barre latérale | `sessionStorage` | préférence d'interface, limitée à la session |

Aucun cookie, aucun traceur, aucun outil analytique, aucune session persistée (§6.2).

**Preuve associée :** un contrôle E2E lit `localStorage` après un parcours complet et exige qu'il
soit **vide**.

## 12. Conteneurisation et build

### 12.1 Développement

`docker-compose.dev.yml` gagne un service `webapp` : Vite en écoute sur `${WEBAPP_DEV_PORT}`,
publié sur l'interface de bouclage comme tous les services de développement. Les sources sont
montées ; `node_modules` reste celui de l'image, pour que des binaires compilés pour une autre
plateforme ne l'écrasent pas. `runDev.sh --dev` écarte ce service (`--scale webapp=0`) lorsque
Vite tourne dans l'IDE : les deux ne peuvent pas coexister, le port serait déjà pris.

L'image est bâtie sur `node:24-alpine`, la version que `.nvmrc` et `engines.node` demandent.
**C'est le seul endroit du projet où ce prérequis est réellement exercé**, et il lève la limite que
`CRM-006` avait nommée.

Le `Dockerfile` accepte un secret de construction **facultatif**, `npm_ca` : derrière un proxy
HTTPS qui interpose son propre certificat, `npm ci` échoue en `SELF_SIGNED_CERT_IN_CHAIN` tant que
l'autorité n'est pas connue du conteneur. Le fichier n'entre ni dans l'image, ni dans le dépôt ;
sans lui, la construction se déroule normalement.

Aucune image de production n'est fabriquée : Caddy sert des fichiers statiques, et en produire une
ajouterait un artefact à construire, publier et faire dériver.

### 12.2 Production

`npm run build` produit `webapp/dist`, que `docker-compose.prod.yml` monte déjà en lecture seule
dans Caddy. Aucune modification de l'assemblage de production n'est nécessaire : le répertoire
cesse simplement d'être vide. Les deux variables `VITE_*` sont lues **au build** : reconstruire est
nécessaire après leur changement, ce que `docs/PROD_MIGRATIONS.md` doit dire.

### 12.3 Frontières de chargement

Mesuré le 2026-08-07 après l'arrivée des écrans métier : le build produit un unique chunk
JavaScript de **530,59 kB minifiés**, au-dessus de l'avertissement Vite de 500 kB. Sa carte source
montre que le point d'entrée importe aussi le board, la liste, le formulaire et la timeline alors
que `/connexion` n'en rend aucun. Augmenter `chunkSizeWarningLimit` ne réduirait ni le téléchargement
ni le travail du navigateur et ne constitue donc pas une correction.

`RouteTrack` et `RouteCard` sont des frontières de chargement dynamique. La connexion,
l'authentification, le routeur et la coquille commune restent dans le point d'entrée ; le code des
routes métier n'est demandé que lorsqu'une URL correspondante est ouverte. Pendant ce chargement,
un squelette portant `role="status"`, `aria-busy="true"` et le libellé traduit du chargement est
rendu : la séparation ne crée jamais de page blanche. Le build doit conserver le seuil Vite par
défaut, produire plusieurs chunks JavaScript et ne rendre aucun avertissement de taille.

## 13. Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | Vite en développement, hors conteneur |
| `npm run build` | build de production vers `webapp/dist` |
| `npm run preview` | sert le build produit, pour les preuves |
| `npm run typecheck` | compile les deux projets TypeScript |
| `npm run test:unit` | Vitest |
| `npm run e2e:ui` | Playwright, parcours et captures |
| `scripts/verify-webapp.sh` | rejoue l'ensemble des preuves de l'unité |

`npm run test:sql`, `e2e:api` et `e2e:report` **ont depuis été livrés par `CRM-008`**
(`docs/SPEC-test-harness.md`). `npm run e2e:ui` y a pris son nom de projet explicite, sans
changer de fond. Seul `e2e:mail` reste dû, faute de Stalwart avant `CRM-050` — voir
`docs/INCONSISTENCY_REPORT.md`, INC-023.

## 14. Preuves attendues

`scripts/verify-webapp.sh` rejoue, sur une pile de développement démarrée :

1. **Build** : `npm run build` vert **sans avertissement de taille**, `webapp/dist/index.html` et
   plusieurs chunks JavaScript produits, et la
   configuration réellement injectée dans le bundle — reprise explicite de la preuve due par
   INC-020.
   Les types générés de `CRM-006` sont importés par le client et la couche d'accès. Ils sont
   **effacés à la compilation** : le bundle n'en contient rien, et prétendre le contraire serait
   faux. Ce qui les prouve utiles est le contrôle suivant : une **colonne inexistante glissée dans
   la requête doit faire échouer `typecheck`** — c'est le schéma qui contraint alors le code.
2. **Compilation** : `npm run typecheck` vert sur les quatre projets.
3. **Jetons** : les valeurs de `docs/DESIGN_SYSTEM.md` §1 sont présentes dans le CSS produit ;
   aucune valeur hexadécimale hors `tokens.css` dans `webapp/src`.
4. **Textes** : aucun texte visible en dur dans un composant.
5. **Unitaires** : `npm run test:unit` vert.
6. **Intégration hors interface** : la requête que la coquille adresse à PostgREST est rejouée
   directement, avec la clé anonyme puis avec le **jeton réel** d'un compte seedé obtenu par la
   véritable route de connexion. Les deux doivent rendre `200` et `[]` **alors que la base
   contient au moins une ligne** — comparaison faite dans le même contrôle. C'est ce qui établit
   que l'écran vide est le refus du backend, et non un défaut de l'interface.
7. **E2E** : `npm run e2e:ui` vert — coquille rendue, quatre paliers responsive, absence de
   défilement horizontal, parcours clavier complet, `localStorage` vide, états de chargement et
   d'erreur atteints en faisant réellement échouer la requête au niveau du réseau.
8. **Console navigateur** : chaque page collecte `console.warning`, `console.error` et
   `pageerror`, et le scénario échoue s'il en reste un. Un refus HTTP volontaire n'est consommé
   qu'après vérification de son effet visible, par égalité sur le message exact et jamais par
   filtre global.
9. **Captures** : produites depuis l'application réellement exécutée, dans `e2e/output/`
   (`docs/DESIGN_SYSTEM.md` §11), copiées dans `docs/captures/CRM-007/`, et **observées**.
10. **Non-complaisance** : le harnais est éprouvé en dégradant réellement le produit, puis en le
   rebuildant — une couleur hexadécimale glissée dans un composant, un texte visible en dur, un
   espacement hors de l'échelle fermée, une colonne inexistante dans une requête — et doit échouer
   dans chaque cas. Il restaure ensuite tout ce qu'il a altéré, et le **constate** en sortant.

## 15. Limites connues

- **Les tables d'identité restent illisibles (INC-014).** Depuis la reprise de `CRM-011`, l'écran
  `/connexion` restaure une session avant les lectures métier et les objets consentis sont
  utilisables. En revanche, `workspaces`, `profiles` et `workspace_members` restent en refus par
  défaut : l'en-tête peut donc afficher « Aucun workspace accessible » malgré une session valide
  et des tracks visibles. Le produit n'invente ni nom d'espace ni identité pour masquer ce refus.
- **HMR non mesuré.** Le service `webapp` de développement sert Vite, et son rendu a été constaté
  (`docs/captures/CRM-007/conteneur-dev-1280.jpg`) ; le rechargement à chaud lui-même n'est éprouvé
  par aucune preuve automatique.
- **Pluriels, dates et nombres** ne sont pas traités par le dictionnaire : aucune donnée réelle ne
  les exige encore.
- **Aucun test de contraste automatisé.** Les contrastes AA sont vérifiés par lecture des jetons et
  observation des captures, pas par un outil.
- **Node 24 est exercé, mais seulement dans le conteneur.** Le service `webapp` tourne sur
  `node:24-alpine` — build, tests unitaires et compilation y ont été rejoués verts. Sur l'hôte de
  vérification, en revanche, la chaîne s'exécute sous Node 22.22.2 : c'est là que passent les
  preuves E2E.
- **Un seul palier de navigateur** : les preuves E2E s'exécutent sur Chromium. Firefox et WebKit ne
  sont pas exercés.
