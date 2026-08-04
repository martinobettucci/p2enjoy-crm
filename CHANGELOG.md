# Changelog

Toutes les modifications notables du projet sont consignées ici.

Deux sections structurent ce fichier :

- **[Non publié]** — ce qui existe dans le code courant mais n'est **pas encore déployé et
  vérifié en production** ;
- **[Publié]** — uniquement ce qui est réellement actif et vérifié en production.

Un changement n'est jamais déclaré publié tant que la production n'a pas été constatée en train
d'exécuter le code attendu.

## [Non publié]

### Corrigé

- **`CRM-020` — le contraste des pilules de track était déclaré, non mesuré.** `docs/DESIGN_SYSTEM.md`
  §8 exige 4,5:1 « y compris pour les badges colorés », et aucune preuve du dépôt ne calculait un
  contraste. Mesuré sur le rendu réel : `success` à **3,82:1** — la couleur du track `studio-web` du
  seed — et `danger` à **3,29:1**. `accent`, à 1,45:1, avait déjà été corrigé parce qu'illisible ;
  les deux autres sont **lisibles sans être conformes** et ne pouvaient être trouvés qu'en mesurant.
  - Quatre jetons **`--color-*-on-soft`** : le jeton conservant sa teinte, assombri juste assez pour
    tenir les 4,5:1 — 7,64 / 4,85 / 4,72 / 4,67. Valeurs **calculées** à partir du jeton plein,
    comme les fonds doux ; `tokens.css` reste le seul fichier à contenir une couleur.
  - `accent` repasse de `text-ink` à `text-accent-on-soft` : le repli sur l'encre était conforme
    mais faisait de lui une **exception** dans un tableau qui devra s'étendre aux badges. Une règle
    unique se propage, une exception se recopie mal.
  - **Preuve ajoutée, et c'est elle le livrable** : `e2e/ui/tracks.spec.ts` mesure le contraste sur
    les couleurs **réellement rendues**, peintes sur un canevas d'un pixel. Lire `getComputedStyle`
    serait faux — Chromium mêle canaux 0–1 (`color-mix`) et octets (couleurs littérales) ; la
    première version de la mesure rendait 2,31:1 pour un contraste de 7,64:1.
  - Le scénario sert désormais **les cinq jetons**, dont `danger` et `neutral` qu'aucun track du
    seed n'emploie : un jeton que rien ne rend n'est jamais mesuré.
  - **Le mappage exact est figé** par `webapp/src/app/presentation-tracks.test.ts`. Les trois
    assertions qui existaient — « non vide », « pas d'hexadécimal », « fond et texte distincts » —
    étaient toutes vertes avec `text-success` : une propriété générale ne remplace pas la valeur
    attendue.
  - **`scripts/verify-tracks.sh` : 43 contrôles, aucune anomalie**, et une **huitième dégradation** —
    le jeton de contraste ramené à la couleur pleine doit faire échouer le projet `ui`. Sans elle,
    rien ne distinguerait « la conformité AA est mesurée » de « la conformité AA est déclarée ».
  - `scripts/verify-harness.sh` : **22 → 23** scénarios `ui` épinglés.
  - Contradiction consignée en **INC-028** : `docs/DESIGN_SYSTEM.md` §5.6 (« texte à la couleur
    pleine ») et §8 sont incompatibles pour trois jetons sur cinq, depuis `CRM-000`. Trois questions
    dépassent cette unité et sont portées à l'arbitrage — réécrire le §5.6 pour tout le produit,
    étendre les jetons aux badges et liserés de card, et maintenir ou non `accent` comme couleur de
    donnée.
  - `docs/DESIGN_SYSTEM.md` §1, §5.6 et **§12.5** (nouvel écart), `docs/JOURNAL.md` mis à jour dans
    le même changement.

### Ajouté

- **`CRM-020` — Tracks (`[~]`).** Premier objet métier du produit, et **premières politiques RLS**.
  - **`supabase/migrations/0003_tracks.sql`** : table `public.tracks` — nom, slug unique par
    workspace, couleur contrainte aux jetons du design system, icône, `position` numérique,
    archivage doux, horodatages. Trigger d'attribution automatique de `position` en fin de liste du
    workspace, et **clé étrangère `track_members.track_id → tracks.id`**, moitié d'INC-010 refermée.
  - **Trois politiques RLS, prouvées hors interface avec les jetons réels des trois profils
    seedés** : lecture par les membres du workspace, insertion et mise à jour par ses
    administrateurs. **Aucune suppression n'est exposée** — ni politique, ni privilège : l'archivage
    tient lieu de suppression, et le refus est mesuré (`403`, `42501`).
  - Le `WITH CHECK` de la mise à jour interdit de **déplacer** un track vers un workspace où
    l'appelant n'est pas administrateur — refus que le `USING` seul aurait laissé passer.
  - **Contraintes de valeur convergentes** : posées par `drop constraint if exists` puis
    `add constraint`, de sorte qu'un rejeu **répare** une contrainte retirée à la main. Défaut réel
    trouvé par le contrôle de restauration du harnais, où `create table if not exists` laissait la
    base durablement affaiblie.
  - **Seed étendu** : quatre tracks dans l'espace de démonstration, dont un **archivé**, pour que
    l'état « archivé » soit démontrable et non seulement documenté. Écriture convergente par la
    véritable API REST.
  - **Barre latérale** : la section « Tracks » lit désormais `public.tracks` — filtrée sur les non
    archivés **côté serveur**, ordonnée par `position` puis par nom. Pilules colorées par jeton,
    précédées de leur icône Lucide, avec repli documenté sur `neutral` et `Folder`.
  - **La zone principale regarde les deux chargements** : un échec sur les tracks n'est plus avalé
    par une barre latérale qui n'a pas la place de l'expliquer.
  - **Preuves** : `supabase/tests/0004_tracks.test.sql` (**78 assertions**),
    `e2e/api/tracks.spec.ts` (**17 scénarios**, dont les preuves de refus n° 3 et n° 11 au niveau
    des tracks), `e2e/ui/tracks.spec.ts` (**9 scénarios**), `webapp/src/lib/tracks.test.ts`,
    `webapp/src/app/presentation-tracks.test.ts`, `webapp/src/app/SectionTracks.test.tsx`
    (**133 tests unitaires** au total), et `scripts/verify-tracks.sh` — **40 contrôles, aucune
    anomalie**.
  - **Harnais non complaisant, éprouvé par sept dégradations réelles** : écriture ouverte aux
    membres, `WITH CHECK` retiré, contrainte de couleur retirée, `DELETE` accordé, trigger de
    position retiré, lecture ouverte à tous, seed privé de son track archivé. Chacune fait échouer
    les preuves ; la restauration est ensuite **constatée**, pas supposée.
  - **Deux défauts trouvés en observant les captures**, alors que toutes les preuves étaient
    vertes : l'écran affirmait « Aucun track n'est accessible » en listant trois tracks, et la
    pilule `accent` n'atteignait pas le contraste AA en texte jaune. Corrigés.
  - **Trois assertions figées par des unités précédentes ont échoué comme prévu et ont été
    révisées** : la clé étrangère absente (`CRM-003`), la liste des tables et les relations de
    `track_members` dans les types (`CRM-006`), les comptes de preuves du harnais (`CRM-008`).
  - **Reste dû, et l'unité reste `[~]` pour cela** : aucun track n'apparaît dans l'interface, et
    aucune interface ne permet de les gérer — la webapp est un appelant anonyme faute d'écran de
    connexion (**INC-021**). Les droits fins ne sont pas appliqués (**INC-024**).
  - Contradictions consignées sans être résolues : **INC-024**, **INC-025**, **INC-026**,
    **INC-027**.

- **`CRM-008` — Harnais de tests (`[~]`).**
  - **`npm run test:sql`** : les trois suites pgTAP de `supabase/tests/`, **227 assertions**, avec
    un verdict **calculé** et non emprunté. Quatre conditions d'échec indépendantes, dont l'écart
    entre le plan annoncé et le nombre d'assertions réellement émises — le seul contrôle qui
    attrape une suite tronquée, pgTAP restant muet lorsque `finish()` manque.
  - **Projet Playwright `api`** et **`npm run e2e:api`** : **13 scénarios verts**, entièrement hors
    interface, aucun navigateur lancé. Refus de la passerelle, schéma `app` non exposé, **preuve
    de refus n° 11**, absence de privilège des trois profils seedés, et refus d'écriture `403`
    doublé de la vérification que la ligne n'a été créée nulle part.
  - **Les jetons viennent de la véritable route de connexion**, jamais fabriqués. `e2e/api/jetons.ts`
    est le livrable durable : `CRM-014` s'y appuiera pour ses douze scénarios.
  - **« Zéro ligne » n'est affirmé que là où il prouve quelque chose** : les tables sont d'abord
    constatées **non vides** avec la clé de service ; les deux tables réellement vides sont exclues.
  - **`npm run e2e:api` ne construit ni ne sert la webapp**, mesuré en supprimant `webapp/dist` et
    en constatant qu'il n'est pas recréé. Playwright démarrant son `webServer` pour toute
    exécution, le besoin est déclaré par `E2E_PROJETS`.
  - **`npm run e2e:report`** : rapporteur `html` avec `open: 'never'`, sortie ignorée par git, et
    rapport **réellement servi** — interrogé en HTTP, `200` constaté.
  - **Aucune régression** : `e2e:ui` reste à 13 scénarios, `test:unit` à 96 tests, `typecheck` vert
    sur les quatre projets ; les neuf harnais précédents rejoués (33, 38, 23, 26, 26, 42, 49, 30,
    41 contrôles).
  - Harnais rejouable `scripts/verify-harness.sh` : **22 contrôles, aucune anomalie**, éprouvé par
    **six dégradations réelles** — assertion fausse, plan tronqué sans `finish()`, erreur SQL,
    **politique RLS permissive réellement posée**, test unitaire faux — chacune devant faire
    échouer la commande visée. Restauration constatée, aucune politique résiduelle.
  - **Reste dû, et l'unité reste `[~]` pour cela** : `pytest mail-sync/tests` et
    `npm run e2e:mail`, dont les sujets arrivent au chunk 4 (INC-023).
- **`docs/SPEC-test-harness.md` — spécification du harnais de tests, écrite avant tout code.**
  L'énoncé de `CRM-008` nommait quatre outils sans dire ce que chacun doit rendre, ni comment un
  harnais peut mentir. Rédigée **après mesure** du comportement réel des outils épinglés, pas de
  mémoire. Mesure fondatrice : `psql` rend `0` sur une suite pgTAP dont **toutes** les assertions
  échouent, et pgTAP n'émet **aucun** diagnostic de plan lorsque `finish()` manque — le code de
  sortie ne peut donc pas servir de verdict, ni le diagnostic de pgTAP le remplacer.
  Décisions 48 à 51 consignées au journal.
- **Contradiction consignée, sans être résolue : INC-023.** La Definition of Done de `CRM-008`
  exige que « chaque commande du `README.md` §7 s'exécute », or deux d'entre elles —
  `pytest mail-sync/tests` et `npm run e2e:mail` — n'ont aucun sujet à exercer avant le chunk 4.
  Les déclarer vides serait une fausse complétion ; fabriquer leur sujet serait préempter
  `CRM-051` et `CRM-054`. Trois options d'arbitrage sont posées, `CRM-008` restera `[~]`.
- **Contradiction consignée, sans être résolue : INC-022.** `docs/DAT.md` §3.1 portait, à quatre
  lignes d'intervalle, « session persistée par la bibliothèque » et « sans persistance de
  session ». La première annonce comme acquise une écriture persistante dans `localStorage` que
  `CLAUDE.md` §11 n'autorise pas sans consentement explicite. La ligne est **signalée sur place**
  comme non tranchée, le comportement livré est **inchangé**, et l'arbitrage — trois postures
  posées — est demandé avant que l'écran de connexion ne soit écrit.
- **Constat d'exploitation consigné au journal : deux exécutions concurrentes de la routine ont
  livré `CRM-007` en double.** Le doublon a été abandonné sans être poussé, la livraison la mieux
  prouvée conservée, et ses affirmations rejouées indépendamment — `typecheck`, 96 tests
  unitaires et `build` verts depuis un `node_modules` reconstruit. La sérialisation de la routine
  est proposée au responsable.

- **`CRM-007` — Squelette de la webapp (`[x]`).**
  - Chaîne complète : Vite 8, React 19, TypeScript strict, Tailwind 4, React Router 8,
    `@supabase/supabase-js`, Lucide. `npm run dev`, `build`, `preview`, `test:unit`, `e2e:ui`.
  - **Jetons du design system en variables CSS**, `webapp/src/styles/tokens.css` étant le seul
    fichier du dépôt autorisé à porter un hexadécimal. Les espaces de noms de Tailwind sont
    **remis à zéro** : `bg-red-500` et `p-7` n'existent pas comme classes.
  - Coquille conforme à `docs/DESIGN_SYSTEM.md` §4 — barre latérale repliable, en-tête, barre
    d'onglets, quatre routes — et **quatre états explicites** : chargement, vide, erreur, refus,
    plus l'état de configuration incomplète. Aucune page blanche.
  - **Les états sont provoqués sur le réseau, pas simulés** : réponse retardée, requête réellement
    abandonnée, `403` réel. La reprise **relance la requête**, ce qu'un scénario prouve en rendant
    la seconde réponse différente de la première.
  - **Preuve d'intégration décisive, hors interface** : la requête de la coquille rend `200` et
    `[]` **avec la clé anonyme comme avec le jeton réel d'un compte seedé**, alors que la base
    contient bien une ligne. L'écran vide est le refus par défaut de `CRM-003`, faute de politiques
    RLS (`CRM-012`) — pas un défaut d'interface.
  - `scripts/verify-webapp.sh` : **41 contrôles, aucune anomalie**, non complaisant et éprouvé en
    dégradant réellement le produit puis en le rebuildant — couleur hexadécimale dans un composant,
    texte visible en dur, espacement hors échelle, colonne inexistante dans une requête.
  - `scripts/lib/classes-css.mjs` : garde née d'un défaut réel — une classe dont le jeton manque
    n'était **pas engendrée, en silence**, et la page défilait horizontalement sous 768 px.
  - **96 tests unitaires** (Vitest, jsdom) et **13 scénarios E2E** (Playwright) contre le **build
    de production** servi, pas contre le serveur de développement.
  - **Deux défauts trouvés en regardant les captures**, alors que tout était vert : à 390 px le
    titre de la route disparaissait ; repliée, la barre latérale rognait sa propre bascule et le
    repli devenait irréversible. Corrigés, et figés par des assertions E2E.
  - Service `webapp` conteneurisé (`node:24-alpine`) : `runDev.sh` cesse de l'annoncer comme dû, et
    **le prérequis Node 24 du dépôt y est exercé pour la première fois** — build, tests et
    compilation rejoués verts dans le conteneur.
  - **Aucune écriture sur l'appareil** : `localStorage` vérifié vide après un parcours complet ;
    le repli de la barre vit en `sessionStorage` ; le client est créé **sans persistance de
    session**, faute de consentement recueilli (`CLAUDE.md` §11).
  - **Aucun texte visible en dur** : dictionnaire typé de 50 clés, `t` refusant une clé inconnue à
    la compilation, et un test qui échoue sur une clé morte.
  - Décisions 45 à 47 consignées dans `docs/JOURNAL.md`, avec les deux défauts que seules les
    captures ont révélés. `docs/DESIGN_SYSTEM.md` §1, §11 et §12 mis à jour ;
    `docs/manual.md` gagne son chapitre 3, écrit depuis l'application exécutée.
  - Les huit harnais précédents rejoués — 33, 38, 23, 26, 26, 42, 49 et 30 contrôles — aucune
    régression.

- **`CRM-006` — Build de la webapp acquis, unité close (`[x]`).**
  - La seule preuve qui manquait à `CRM-006` est acquise par `CRM-007`, exactement comme
    **INC-020** l'avait prévu : `npm run build` est vert et le code importe réellement les types
    générés. Les types étant effacés à la compilation, ce qui établit qu'ils **contraignent** le
    code est un contrôle non complaisant — une colonne inexistante fait échouer `npm run typecheck`.
  - **INC-020 close.**

- **`CRM-007` — Spécification du squelette de la webapp, écrite avant tout code.**
  - `docs/SPEC-webapp.md` : où vit la webapp, comment elle se build, comment les jetons du design
    system deviennent des variables CSS, quelle coquille est livrée, et **ce que chaque état de
    l'interface signifie** — chargement, vide, erreur, absence de droit.
  - Spécification rédigée **après mesure** de la chaîne réellement installée, et non de mémoire :
    `vite@8.2.0` (build vert, 1 782 modules en 219 ms), `tailwindcss@4.3.3` (jetons émis sur
    `:root,:host`, utilitaires en `var(--…)`), `vitest@4.1.10` sur `jsdom`, et
    `@playwright/test@1.62.1` dont le navigateur attendu a été **réellement téléchargé** puis a
    produit une capture.
  - Mesure fondatrice du §6.3 : sous la clé anonyme, `GET /rest/v1/workspaces` rend `200` et `[]`.
    L'état vide de l'interface sera donc **le refus du backend**, pas un défaut de l'interface.
  - Décisions 40 à 44 consignées dans `docs/JOURNAL.md` : React 19 avec `docs/DAT.md` corrigé
    plutôt que contourné ; TypeScript conservé à `5.9.3` après réexamen **mesuré** de `7.0.2`
    (décision 39 close) ; projet npm unique avec Vite pointé sur `webapp/` ; aucune bibliothèque
    d'internationalisation ; client Supabase **sans persistance de session**, faute de
    consentement recueilli (`CLAUDE.md` §11).
  - **INC-021** ouverte : aucune unité ne porte l'écran de connexion, que la Definition of Done de
    `CRM-011` présuppose pourtant. Trois options d'arbitrage sont posées, **aucune n'est prise** ;
    l'écran n'est pas écrit par anticipation.

- **`CRM-006` — Spécification des types générés, écrite avant tout code.**
  - `docs/SPEC-types.md` : d'où viennent les types TypeScript du produit, où ils vivent, comment
    ils se régénèrent, et **ce qui prouve qu'ils n'ont pas dérivé** du schéma réellement migré.
  - Spécification rédigée **après mesure** du comportement réel de
    `supabase/postgres-meta:v0.96.6`, la version épinglée : route, code `200`, sortie de 300 lignes
    et 8 527 octets sur le schéma d'amorçage, **déterminisme constaté** sur deux appels successifs.
  - Mesure notable : le service `meta` **ne publie aucun port** sur l'hôte — la génération passe
    nécessairement par `docker exec`, et exige donc la pile de développement démarrée.
  - Mesure notable : `detect_one_to_one_relationships=true` ajoute `isOneToOne` aux relations ;
    sans lui, `supabase-js` type mal une relation embarquée.
  - Limite nommée d'emblée : les contraintes `CHECK` **ne survivent pas** à la génération —
    `workspace_members.role` se type `string`, pas `'admin' | 'business_developer' | 'viewer'`.
    Seule la base refuse une valeur hors vocabulaire.
  - Décisions 36 à 38 consignées dans `docs/JOURNAL.md` : fichier **versionné** plutôt que produit
    au build, générateur `postgres-meta` déjà présent plutôt que CLI à télécharger, et
    `package.json` introduit par cette unité **réduit aux commandes que sa DoD nomme**.
  - **INC-008** mise à jour : sa première question est réglée par nécessité, la seconde — une
    façade `npm` par-dessus les scripts — reste **ouverte et non préemptée**.

- **`CRM-006` — Types TypeScript générés depuis le schéma (`[~]`).**
  - `webapp/src/lib/database.types.ts` : les types du socle d'identité, **générés depuis la base
    réellement migrée** et versionnés, en-tête de traçabilité réémis à chaque génération.
  - `scripts/generate-types.sh` : trois modes — régénération, `--check` qui compare sans écrire,
    `--stdout`. Aucune dépendance nouvelle : le générateur est le service `meta` déjà présent pour
    Studio (décision 37).
  - `package.json` et `tsconfig.json` : `npm run types:generate`, `npm run types:check`,
    `npm run typecheck`, en mode `strict`. **Aucun alias `npm` des scripts de lancement** — la
    façade `npm` reste un arbitrage ouvert (décision 38, INC-008).
  - `webapp/src/lib/database.types.test-d.ts` : **19 assertions de type** vérifiées à la
    compilation, dont deux qui **figent des limites connues** et échoueront volontairement quand
    leur cause disparaîtra — le vocabulaire des rôles s'il devient un type énuméré, les relations
    incomplètes à `CRM-020` et `CRM-021`.
  - `scripts/verify-types.sh` : **30 contrôles, aucune anomalie**. Garde anti-dérive éprouvée
    **par le fichier et par le schéma** — une table réellement créée en base la fait échouer, puis
    son retrait rend la sortie identique au fichier versionné. Générateur arrêté : échec explicite
    et **aucun fichier écrit**, vérifié par empreinte.
  - Les sept harnais des unités précédentes rejoués — 33, 38, 23, 26, 26, 42 et 49 contrôles —
    aucune régression.
  - **Reste ouvert** : le build de la webapp qu'exige la Definition of Done, impossible avant
    `CRM-007` faute de webapp. Contradiction d'ordonnancement consignée en **INC-020**, remplacée
    par un `tsc --noEmit` strict qui est **moins qu'un build** et le dit.
  - Limites nommées : les contraintes `CHECK` ne survivent pas à la génération (`role` se type
    `string`) ; les types n'expriment aucun droit ; le prérequis Node 24 du dépôt n'a pas été
    exercé, les preuves ayant été obtenues sur Node 22.22.2.

- **`CRM-005` — Spécification du seed, écrite avant tout code.**
  - `docs/SPEC-seed.md` : contrat des données de développement — l'espace de travail, les trois
    comptes et leurs rôles, les identifiants **stables**, le mot de passe de développement, les
    gardes, et les **12 preuves** exigées, toutes exécutées hors interface.
  - Spécification rédigée **après mesure** du comportement réel de `supabase/gotrue:v2.189.0` et
    de `postgrest/postgrest:v14.12`, et non de mémoire.
  - Mesure notable : l'API d'administration GoTrue **accepte un identifiant fourni** par
    l'appelant, ce qui rend les identifiants stables tenables sans lecture préalable.
  - Mesure notable : mettre à jour les métadonnées d'un compte **ne met pas à jour son profil** —
    le trigger de `CRM-003` est `AFTER INSERT` et ne réécrit jamais un profil existant. Le seed
    converge donc `profiles` explicitement, au lieu de le supposer.
  - Mesure notable : l'API d'administration **n'applique pas** la politique de mot de passe qu'un
    utilisateur subit — un mot de passe de 8 caractères crée un compte qui se connecte réellement.
  - Décisions 32 à 34 consignées dans `docs/JOURNAL.md` ; contradiction **INC-018** (politique de
    mot de passe démentie sur le chemin d'administration) consignée **sans résolution implicite**.

- **`CRM-005` — Seed socle livré et prouvé (`[x]`).**
  - `supabase/seed/apply-seed.sh` : un espace de travail **P2Enjoy SAS** et trois comptes couvrant
    les trois rôles de workspace — `admin`, `business_developer`, `viewer`.
  - **Produit par les vrais mécanismes** : comptes par l'API d'administration GoTrue, profils par
    le trigger de `CRM-003`, espace de travail et appartenances par l'API REST. **Aucun `psql`,
    aucun `INSERT` direct** (décision 32).
  - **Identifiants stables**, fixés et préfixés `5eed` pour qu'une ligne seedée se reconnaisse sans
    requête (décision 33). Rendu possible par une mesure : l'API accepte un `id` fourni.
  - **Convergent** (décision 34) : rejoué sans doublon, il rattrape une dérive réellement
    provoquée. Le profil est convergé par un `PATCH` explicite, une mise à jour de métadonnées ne
    déclenchant pas le trigger de `CRM-003`.
  - **Garde** : refuse tout profil d'environnement autre que `dev`, et il est vérifié qu'aucune
    écriture n'a lieu pendant ce refus. La production n'applique jamais de seed.
  - `supabase/tests/0003_seed_socle.test.sql` : **30 assertions** pgTAP, le même contrat vu au
    niveau SQL. `scripts/verify-seed.sh` : **49 contrôles, aucune anomalie**, couvrant les 12
    preuves de `docs/SPEC-seed.md` §7 hors interface, dont la **connexion réelle** des trois
    comptes et la conformité du `sub` de leur jeton.
  - Harnais **non complaisant, éprouvé en faussant réellement le seed** : rôle faussé → 4
    anomalies ; identifiant faussé → jusqu'à 7 anomalies ; code de sortie `1` à chaque fois.
  - Vérification visuelle observée : `docs/captures/CRM-005/` — comptes, profils, workspace et
    appartenances dans Studio.

- **`CRM-011` — Spécification de l'authentification, écrite avant tout code.**
  - `docs/SPEC-auth.md` : cycle de vie d'un compte de bout en bout — inscription libre refusée,
    invitation, acceptation, connexion, session, déconnexion, réinitialisation de mot de passe —,
    politique de mot de passe, contenu du jeton, et les **20 preuves de refus et d'acceptation**
    exigées, toutes exécutées hors interface.
  - Spécification rédigée **après mesure** du comportement réel de `supabase/gotrue:v2.189.0` et
    non de mémoire : GoTrue est un service tiers dont le comportement fait autorité.
  - Mesure notable : le refus d'inscription libre **n'est pas contournable par le privilège** — la
    clé `service_role` est refusée exactement comme la clé anonyme.
  - Mesure notable : l'API ne renseigne pas sur l'existence d'un compte — adresse inconnue et mot
    de passe erroné rendent le même message, et `recover` sur une adresse inconnue rend `200` sans
    émettre d'email.
  - Décisions 29 à 31 consignées dans `docs/JOURNAL.md` ; contradictions **INC-015** (parcours
    d'invitation sans composant pour le porter) et **INC-016** (gabarits d'emails, repli silencieux
    vers l'anglais) consignées sans résolution implicite.

- **`CRM-011` — Authentification durcie et prouvée hors interface (partiel : ni écran ni E2E
  d'interface avant `CRM-007`).**
  - **La longueur minimale de mot de passe passe de 6 à 12** (décision 29). Le défaut de GoTrue
    n'était pas théorique : un mot de passe de six caractères était **réellement accepté**.
    Nouvelle variable `PASSWORD_MIN_LENGTH`, documentée dans `.env.example` et câblée dans le
    service `auth`. Prouvée dans les deux sens — onze caractères refusés, douze acceptés.
  - `scripts/verify-auth.sh` : harnais de preuves rejouable, **42 contrôles, aucune anomalie**,
    couvrant les vingt scénarios de `docs/SPEC-auth.md` §7 — invitation, acceptation **en suivant
    le lien de l'email reçu**, connexion, refus, contenu du jeton, session, déconnexion,
    réinitialisation menée à son terme, suppression.
  - **Le harnais commence par comparer la configuration réellement appliquée au conteneur aux
    valeurs du `.env`** : sans ce contrôle, tous les suivants mesureraient les défauts de l'image
    en croyant mesurer le produit.
  - **Non-complaisance éprouvée dans les deux sens** : un GoTrue **jetable**, même version
    épinglée, portant le réglage affaibli, doit accepter ce que la pile refuse ; et le harnais a été
    **réellement mis en échec** contre la pile affaiblie — `DISABLE_SIGNUP=false` produit
    6 anomalies, `PASSWORD_MIN_LENGTH=6` en produit 2.
  - **Vérification visuelle observée** : `docs/captures/CRM-011/` — moniteur Inbucket et les deux
    emails ouverts. Constat relevé à cette occasion : les emails de GoTrue sont en **HTML seul**,
    sans partie `text/plain` (INC-016).
  - **Comportement d'exploitation mesuré et documenté** : une variable ajoutée au gabarit
    n'atteint pas un `.env` existant, mais la garde de `CRM-002` refuse le démarrage et **nomme**
    la variable manquante. Marche à suivre écrite dans `docs/PROD_MIGRATIONS.md` §4.
  - `README.md` §7, §9, §10 et §11, `docs/DAT.md` §4.1 et §7, `docs/PROD_MIGRATIONS.md` §2 et §4,
    `docs/manual.md` mis à jour. **INC-017** relevée au passage : `README.md` §11 annonce encore
    comme non vérifié ce que `CRM-004` a mesuré — consignée, non corrigée ici, car elle relève
    d'un autre périmètre.

- **`CRM-010` — Fonctions d'autorisation (partiel : 4 fonctions sur 6, voir INC-013).**
  - `supabase/migrations/0002_fonctions_autorisation.sql` : `app.resolve_access`,
    `app.workspace_role`, `app.is_workspace_member`, `app.is_workspace_admin`. **Aucune politique
    RLS** — le refus par défaut posé par `CRM-003` reste intact, ce que les preuves vérifient
    explicitement.
  - **L'algorithme de résolution des droits fins est isolé des tables qu'il ne peut pas encore
    lire** (décision 25). `app.resolve_access(ws_role, track_access, channel_access)` est une
    fonction **pure** : elle se prouve par énumération **exhaustive** de ses **64 combinaisons**
    d'entrées, sans fixture ni compte. Les quatre fonctions différées n'auront plus qu'à lire leur
    ligne et l'appeler.
  - **L'absence de récursion est démontrée en la provoquant** (décision 27) : une politique
    auto-référente échoue en `42P17`, une jumelle `SECURITY INVOKER` épuise la pile en `54001`, et
    la même politique adossée à la fonction livrée répond sans erreur avec le filtrage attendu.
    Fait relevé au passage, contraire à l'attente : PostgreSQL **ne détecte pas** la récursion
    lorsqu'elle traverse une fonction.
  - **Les droits ne sont pas portés par le jeton** : l'appartenance retirée, le même jeton non
    expiré cesse immédiatement d'ouvrir des droits. Mesuré en base **et** sous PostgREST.
  - **`EXECUTE` est accordé à `anon`** (décision 26), pour que le refus d'un appelant anonyme reste
    **zéro ligne** au lieu d'une erreur de privilège. Le droit n'ouvre rien, et `PUBLIC` reste
    exclu — vérifié sur l'ACL des quatre fonctions.
  - `scripts/verify-authz.sh` : harnais de preuves rejouable, **26 contrôles, aucune anomalie**, et
    non complaisant — sept affaiblissements volontaires le font échouer. Suite pgTAP
    `supabase/tests/0002_fonctions_autorisation.test.sql` : **127 assertions, aucune anomalie**.
  - Preuves **hors interface** avec les jetons réels de trois profils : chaque profil ne voit que
    son workspace, l'anonyme obtient `200` et `[]` (preuve n° 11), un `viewer` ne modifie rien, un
    administrateur d'un autre workspace non plus (preuve n° 3). Le schéma `app` n'étant pas exposé
    par l'API, deux politiques d'instrumentation sont posées temporairement puis retirées, et
    l'absence de toute politique résiduelle est vérifiée (décision 28).
  - `docs/INCONSISTENCY_REPORT.md` : **INC-013 ouverte** — quatre des six fonctions dépendent de
    `tracks`, `channels` et `cards`, livrées deux chunks plus tard ; trois options d'arbitrage sont
    proposées, à trancher avant `CRM-012`. **INC-014 ouverte** — aucune unité ne porte nommément
    les politiques RLS des tables d'identité, ni la preuve de refus n° 10.
  - `docs/SCHEMA.md` §9, `docs/SPEC-permissions-rls.md` §3, §3.1, §3.2, `docs/DAT.md` §7,
    `docs/PROD_MIGRATIONS.md` §3, `README.md` §5 et §7 mis à jour dans le même changement.
  - **L'unité reste `[~]`** : les quatre fonctions `can_*` ne sont pas livrables dans l'ordre
    actuel du plan.

- **`CRM-004` — Chiffrement des secrets de messagerie : hypothèse levée, décision prise.**
  - `scripts/verify-vault.sh` : harnais de preuves rejouable et **autonome** — il ne dépend ni de
    `.env` ni de la pile en cours d'exécution, crée ses propres conteneur et volumes jetables et
    les détruit en sortant. **26 vérifications, aucune anomalie.**
  - L'image **réellement épinglée** par `docker-compose.yml` est mesurée, et non supposée :
    `supabase_vault` **0.3.1** présente, déjà installée et préchargée ; `pg_cron` **1.6.4**
    disponible, préchargé et fonctionnel ; `pgcrypto` 1.3, `pg_net` 0.20.3, `pgtap` 1.3.3.
  - **Vault est retenu ; le repli `pgcrypto` est abandonné** (décision 23). Entretenir un second
    chemin de chiffrement que rien n'obligerait à exercer reviendrait à ne jamais l'éprouver avant
    le jour où il servirait.
  - Cloisonnement mesuré **hors interface** avec les rôles réels : `anon` et `authenticated` sont
    refusés sur le schéma `vault` tout entier — donc plus fortement qu'un `REVOKE` de colonne —,
    tandis que `service_role` lit, déchiffre et crée. Le `REVOKE` sur `secret_id` reste exigé : il
    porte sur des tables de `public`, exposées par PostgREST.
  - **La clé racine de Vault vit hors de `PGDATA`** (décision 24), dans le volume `db-config`.
    Mesuré : PGDATA restauré sans elle, le chiffré subsiste et le déchiffrement échoue. Elle
    devient un **élément obligatoire du périmètre de sauvegarde** — `docs/DAT.md` §10 et
    `docs/PROD_MIGRATIONS.md` §2.1, §5, §6, §7.
  - `docs/INCONSISTENCY_REPORT.md` : **INC-001 close**, avec sa mesure et sa décision. **INC-012
    ouverte** : la mesure dément le motif principal de la décision 8 — `pg_cron` est disponible.
    Le résultat de la décision est conservé, son énoncé corrigé dans `docs/DAT.md` §3.3 et §12, et
    la réouverture de l'arbitrage est laissée au responsable.
  - `docs/DAT.md` §8, §10, §12, §15, `docs/SCHEMA.md` §11, `docs/SPEC-mail-subsystem.md` §2.3,
    `README.md` §5, §7, §12 mis à jour dans le même changement.
  - **Débloque `CRM-052` et `CRM-053`.**

- **`CRM-003` — Migrations d'amorçage : identité et cloisonnement.**
  - `supabase/migrations/0001_identite_et_cloisonnement.sql` : extension `pgcrypto`, schéma `app`
    (non exposé par l'API REST), et les cinq tables de `docs/SCHEMA.md` §1 — `profiles`,
    `workspaces`, `workspace_members`, `track_members`, `channel_members`.
  - Création automatique du profil à l'ouverture d'un compte, par trigger sur `auth.users` : le
    seul point qui capte tous les modes de création — invitation, seed, API d'administration.
  - **Refus par défaut** : RLS activée sur les cinq tables, sans aucune politique. Une lecture
    anonyme ou authentifiée retourne zéro ligne, une écriture est refusée, jusqu'aux politiques de
    `CRM-010` et `CRM-012`. Les privilèges de table sont posés explicitement plutôt qu'hérités des
    privilèges par défaut de l'image.
  - Les migrations du dépôt sont **idempotentes** : le `migrations-runner` ne tient aucun registre
    et rejoue tout le répertoire à chaque démarrage.
  - `supabase/tests/0001_identite_et_cloisonnement.test.sql` : suite pgTAP de l'unité
    (**70 assertions**).
  - `scripts/verify-migrations.sh` : harnais rejouable des preuves de l'unité (**23 contrôles**),
    dont la création d'un compte par l'API d'administration GoTrue et les refus mesurés hors
    interface avec les jetons réels.
- **`CRM-002` — Scripts de lancement et contrat d'environnement.** *(unité `[~]` : une preuve
  reste bloquée par une dépendance, voir les notes)*
  - `.env.example` : gabarit documenté des **76** variables — rôle, format, caractère
    obligatoire, valeur d'exemple non sensible. Aucun secret réel ; les valeurs sensibles portent
    un marqueur `CHANGE_ME_*`.
  - `runDev.sh` : amorce `.env` au premier lancement en **tirant chaque secret au hasard**, en
    mode `600`, sans jamais écraser un fichier existant. `ANON_KEY` et `SERVICE_ROLE_KEY` sont
    dérivées du `JWT_SECRET` produit, sous forme de jetons HS256 valides. Options `--dev`,
    `--withLog <composant>`, `--bootstrap`, `--stop`.
  - `runProd.sh` : démarre l'assemblage de production. N'amorce jamais de fichier
    d'environnement et n'invente aucun secret ; refuse un profil de développement et refuse
    `APPLY_MIGRATIONS=true`.
  - `resetMe.sh` : détruit la base et les volumes locaux, redémarre à froid, rejoue les
    migrations, puis le seed s'il existe. Refuse tout profil autre que `dev` et exige une
    confirmation explicite.
  - `scripts/lib/env.sh` : socle commun — lecture du fichier d'environnement, amorçage,
    validation contre le gabarit, gardes de profil.
  - `scripts/verify-scripts.sh` : harnais rejouable des preuves de l'unité (**38 contrôles**).
  - Nouvelle variable `P2ENJOY_ENV_PROFILE` (`dev` ou `prod`), garde des trois scripts.
  - `STACK_RLIMIT_NOFILE` s'ajuste à la limite dure de l'hôte lors de l'amorçage, et le signale.
- **`CRM-001` — Pile Supabase self-hosted, à versions épinglées.**
  - `docker-compose.yml` : assemblage commun — PostgreSQL 17, GoTrue, PostgREST, Realtime,
    Storage, Supavisor, Kong, et un conteneur `migrations-runner` qui rejoue
    `supabase/migrations/*.sql` au démarrage.
  - `docker-compose.dev.yml` : Supabase Studio, `postgres-meta`, MinIO et Inbucket, tous publiés
    sur l'interface de bouclage uniquement.
  - `docker-compose.prod.yml` : Caddy pour TLS et fichiers statiques, aucun outillage de
    développement, ni Kong ni PostgreSQL exposés.
  - `supabase/docker/` : configuration déclarative de Kong et scripts d'initialisation de la
    base, repris de la distribution self-hosted officielle.
  - `caddy/Caddyfile` : terminaison TLS, en-têtes de sécurité, application monopage.
  - `scripts/verify-stack.sh` : harnais rejouable des preuves de la Definition of Done
    (33 contrôles).
  - Le stockage vise **toujours** S3 : MinIO en développement, fournisseur réel en production.
  - Captures de vérification visuelle : `docs/captures/CRM-001/`.
- Amorçage du dépôt : `.gitignore`, `.editorconfig`, `.nvmrc` (Node 24).
- Documentation de référence complète, rédigée et committée **avant tout code**, conformément à
  la règle de persistance immédiate des décisions :
  - `README.md` — objectif, stack, prérequis, commandes, variables, structure, limites connues ;
  - `docs/DAT.md` — architecture technique, composants, flux, déploiement, compromis ;
  - `docs/SCHEMA.md` — modèle de données complet et contraintes ;
  - `docs/DESIGN_SYSTEM.md` — charte P2Enjoy appliquée au CRM, tokens, composants, accessibilité ;
  - `docs/SPEC-workflow-engine.md` — catalogue de nœuds partagé, workflows dérivables par track,
    transitions contraintes appliquées côté base ;
  - `docs/SPEC-form-composer.md` — champs conditionnels par étape et validation au moment de la
    transition ;
  - `docs/SPEC-mail-subsystem.md` — comptes entrants IMAP et identités sortantes SMTP découplés,
    classement des messages, dossiers imbriqués, file d'envoi résiliente ;
  - `docs/SPEC-permissions-rls.md` — rôles, politiques RLS et preuves de refus exigées ;
  - `docs/MASTER_PLAN.md` — index d'exécution autoritatif référencé par les commentaires `@spec` ;
  - `docs/BACKLOG.md` — unités `CRM-NNN` avec leur Definition of Done ;
  - `docs/JOURNAL.md` — décisions de conception et leurs justifications ;
  - `docs/PROD_MIGRATIONS.md` — contrat de déploiement et prérequis manuels ;
  - `docs/manual.md` — manuel utilisateur ;
  - `docs/INCONSISTENCY_REPORT.md` — registre des contradictions en attente d'arbitrage.

### Corrigé

- **`CRM-002` passe `[x]`.** Sa dernière case ouverte — « `resetMe.sh` rejoue le seed » — est
  levée : `./resetMe.sh --yes` détruit le cluster, rejoue les migrations à blanc **puis applique
  le seed**, en 45,6 s, et les trois comptes sont constatés sur la base neuve. INC-009 peut être
  close par le responsable.
- **Suite pgTAP de `CRM-003` corrigée** (décision 35) : elle supposait une base vide — décompte
  global des profils, et slug `p2enjoy` réservé, ce dernier provoquant une **erreur d'insertion**
  qui interrompait tout ce qui suivait. Elle ne porte plus que sur ses propres fixtures et repasse
  à **70/70**. Aucune régression sur les sept harnais : **237 contrôles** au total.
- Contradiction **INC-019** consignée : le bandeau d'état du `README.md` décrit encore un dépôt
  sans migrations, dépassé depuis `CRM-003`. **Non corrigée ici** — elle relève de l'état global du
  dépôt, pas du périmètre de cette unité.

### Notes

- La pile d'exécution et son outillage de lancement sont livrés et vérifiés, mais **aucun code
  applicatif ni aucune migration** ne l'est encore : `supabase/migrations/` est vide, il n'y a ni
  webapp ni service `mail-sync`.
- `CRM-002` reste `[~]` : la branche « rejoue le seed » de `resetMe.sh` **n'a pas pu être
  prouvée**, faute de seed — c'est l'objet de `CRM-005`, planifiée plus tard. Contradiction
  d'ordonnancement consignée dans `docs/INCONSISTENCY_REPORT.md`, INC-009. Aucun seed factice
  n'a été fabriqué pour rendre la preuve verte.
- Limites de vérification nommées dans `docs/BACKLOG.md` (`CRM-001`, `CRM-002`) : valeur par
  défaut de `STACK_RLIMIT_NOFILE` non éprouvée, certificat ACME non obtenu, production démarrée
  contre un fournisseur S3 simulé.
- Les commandes `npm` annoncées sans `package.json` — dont `npm run stop`, attribué à `CRM-002` —
  sont consignées dans `docs/INCONSISTENCY_REPORT.md`, INC-008. L'arrêt propre passe par
  `./runDev.sh --stop` et `./runProd.sh --stop`.

## [Publié]

_Rien à publier pour le moment._
