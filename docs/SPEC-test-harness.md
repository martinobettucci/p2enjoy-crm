# Spécification — Harnais de tests

**Unité :** `CRM-008` (`docs/BACKLOG.md`, chunk 2).
**Documents liés :** `docs/MASTER_PLAN.md` §4 (Definition of Done commune),
`docs/SPEC-permissions-rls.md` §7 (preuves de refus), `docs/SPEC-webapp.md` §13 (commandes),
`docs/DAT.md` §13 (commandes de lancement), `README.md` §7 (tests).

Ce document est écrit **avant** le code du harnais, et **après mesure** du comportement réel des
outils déjà épinglés par le dépôt : `postgres:17.6.1.136` et son `pgtap 1.3.3`,
`@playwright/test@1.62.1`, `vitest@4.1.10`. Les paragraphes intitulés « Mesuré » rapportent une
sortie de commande réellement obtenue le 2026-08-04 sur la pile de développement, pas un
comportement supposé d'après la documentation des outils.

---

## 1. Objet

`CRM-008` livre **l'outillage qui exécute les preuves**, pas les preuves elles-mêmes. La
distinction gouverne tout ce document : un harnais capable de lancer un scénario n'est pas un
scénario, et une commande qui rend `0` sans rien avoir exercé est pire qu'une commande absente —
elle donne une couleur verte à un périmètre vide.

Le dépôt possède déjà, à l'ouverture de cette unité :

- une suite pgTAP de **trois fichiers** dans `supabase/tests/`, exécutée aujourd'hui par trois
  scripts de vérification distincts, chacun réimplémentant sa propre lecture du TAP ;
- Vitest, livré par `CRM-007`, avec 96 tests d'interface ;
- Playwright, livré par `CRM-007`, avec un unique projet `ui` et 13 scénarios ;
- neuf harnais `scripts/verify-*.sh`, qui sont les preuves d'intégration des unités précédentes.

Ce que `CRM-008` ajoute est donc précisément ce qui manque pour que `README.md` §7 cesse de
décrire un état futur :

| Commande | État à l'ouverture de l'unité | Livrée par `CRM-008` |
|---|---|---|
| `npm run test:unit` | livrée par `CRM-007` | inchangée |
| `npm run e2e:ui` | livrée par `CRM-007` | projet nommé explicitement |
| `npm run test:sql` | absente | **oui** |
| `npm run e2e:api` | absente | **oui** |
| `npm run e2e:report` | absente | **oui** |
| `pytest mail-sync/tests` | absente | **non** — voir §8 |
| `npm run e2e:mail` | absente | **non** — voir §8 |

## 2. Ce que le harnais n'invente pas

Deux des sept commandes de `README.md` §7 n'ont **aucun sujet à exercer** avant le chunk 4 :

- `pytest mail-sync/tests` suppose le service `mail-sync`, livré par `CRM-051` ;
- `npm run e2e:mail` suppose Stalwart et un aller-retour d'email réel, livrés par `CRM-050` et
  `CRM-054`.

Trois conduites étaient possibles. Déclarer les projets vides : rejetée, c'est exactement
l'illusion que `e2e/playwright.config.ts` refusait déjà en toutes lettres depuis `CRM-007`.
Fabriquer un `mail-sync/` minimal pour avoir quelque chose à tester : rejetée, c'est préempter
`CRM-051` et gonfler l'unité au-delà de son énoncé (`CLAUDE.md` §1). Livrer ce qui est livrable et
**nommer** le reste : retenue.

La contradiction d'ordonnancement — une Definition of Done qui exige l'exécution de commandes dont
les sujets arrivent deux chunks plus loin — est consignée dans `docs/INCONSISTENCY_REPORT.md`,
**INC-023**, sans être résolue implicitement. Tant qu'elle n'est pas arbitrée, `CRM-008` reste
`[~]`.

## 3. `npm run test:sql` — exécuteur pgTAP

### 3.1 Ce que `psql` ne dit pas (mesuré)

Une suite pgTAP s'exécute par `psql`. Or `psql` ne connaît rien au protocole TAP : il rend `0` dès
lors que les ordres SQL se sont exécutés, **que les assertions soient vraies ou fausses**.

Mesuré le 2026-08-04, contre `p2enjoy-db` :

| Situation | Sortie TAP | Code de sortie de `psql` |
|---|---|---|
| Suite verte (`0003_seed_socle.test.sql`, 30 assertions) | `ok 1…30` | `0` |
| Une assertion fausse | `not ok 2` + `# Looks like you failed 1 test of 2` | **`0`** |
| Plan annoncé `5`, une seule assertion exécutée | `# Looks like you planned 5 tests but ran 1` | **`0`** |
| Plan annoncé `1`, `finish()` **jamais appelé** | `ok 1`, **aucun diagnostic** | **`0`** |
| Plan annoncé `3`, dernières assertions dans un `savepoint` annulé | `ok 1…3` **et** `# Looks like you planned 3 tests but ran 1` | **`0`** |
| Erreur SQL, avec `ON_ERROR_STOP=1` | message d'erreur | `3` |

Trois conséquences, qui sont la raison d'être de l'exécuteur :

1. **Le code de sortie de `psql` ne peut pas servir de verdict.** Un harnais qui s'y fierait
   rendrait vert sur une suite entièrement rouge. C'est le mode de défaillance le plus grave que
   puisse avoir un outil de test, puisqu'il est silencieux.
2. **Le diagnostic de pgTAP ne suffit pas non plus.** Sans `finish()`, pgTAP n'émet aucune ligne
   `# Looks like you planned` : une suite tronquée — par un `return` prématuré, une erreur avalée,
   un fichier coupé — passerait pour complète. L'exécuteur doit donc comparer **lui-même** l'en-tête
   de plan `1..N` au nombre de lignes `ok` et `not ok` réellement émises.
3. **`ON_ERROR_STOP=1` est obligatoire.** Sans lui, une erreur SQL au milieu d'un fichier laisse la
   suite continuer et le code de sortie reste `0`.
4. **Compter les lignes émises ne suffit pas non plus, et c'est la quatrième mesure de ce
   tableau.** pgTAP tient deux comptes distincts : la **numérotation** des lignes, portée par une
   séquence, et le **compte** que `finish()` relit, porté par une table. Un `rollback to savepoint`
   annule le second et pas le premier. Une suite dont les **dernières** assertions sont prises dans
   un savepoint annulé émet donc autant de lignes que son plan en annonce — l'exécuteur la voit
   complète — alors que pgTAP la déclare tronquée. Mesuré sur trois lignes :

   ```sql
   select plan(3);
   select ok(true, 'hors savepoint');
   savepoint s1;
   select ok(true, 'dans le savepoint');
   select ok(true, 'derniere assertion, dans le meme savepoint');
   rollback to s1;
   select * from finish();
   ```

   Sortie : `ok 1`, `ok 2`, `ok 3`, puis `# Looks like you planned 3 tests but ran 1`. Le contrôle 4
   du §3.2 compare `3` à `3` et **passe**. C'est exactement le mode de défaillance silencieux que ce
   tableau existe pour empêcher, et il visait l'exécuteur lui-même (`docs/JOURNAL.md`, décision 79).

   Les suites `0002` à `0007` restent vertes et plan tenu : toutes se terminent par au moins une
   assertion **hors savepoint**, qui remet le compte d'accord avec la numérotation. C'est la
   différence que la décision 76 avait relevée sans l'élucider.

### 3.2 Contrat de l'exécuteur

`scripts/run-sql-tests.sh`, invoqué par `npm run test:sql`.

- **Périmètre** : tous les fichiers `supabase/tests/*.test.sql`, dans l'ordre lexicographique de
  leur nom — qui est l'ordre des migrations qu'ils accompagnent.
- **Cible** : le conteneur `p2enjoy-db` de la pile de développement. L'exécuteur **ne démarre ni
  n'arrête rien** ; il échoue explicitement si le conteneur est absent, comme le font déjà les
  neuf `scripts/verify-*.sh`.
- **Verdict par fichier**, dans cet ordre :
  1. si `psql` sort en erreur (code ≠ `0`) → **échec**, la sortie brute est reproduite ;
  2. si aucune ligne `1..N` n'est trouvée → **échec** : le fichier n'a pas produit de plan, il
     n'est donc pas une suite pgTAP exécutée ;
  3. si au moins une ligne `not ok` est présente → **échec**, les lignes `not ok` et leurs
     diagnostics `#` sont reproduits ;
  4. si `N` diffère du nombre de lignes `ok` + `not ok` → **échec**, l'écart est chiffré ;
  5. si pgTAP a émis un diagnostic de plan — une ligne `# Looks like you planned` — → **échec**,
     la ligne est reproduite. Ce contrôle est **indépendant** du précédent et ne le double pas : le
     contrôle 4 compare le plan aux lignes **émises**, celui-ci au compte que pgTAP a
     **enregistré**, et les deux divergent dès qu'un `rollback to savepoint` intervient après la
     dernière assertion (§3.1, mesure 4) ;
  6. sinon → **succès**, avec le nombre d'assertions.
- **Verdict global** : `0` si et seulement si tous les fichiers réussissent ; `1` sinon.
- **Options** : un ou plusieurs chemins de fichiers en arguments restreignent le périmètre ;
  `--help` décrit l'usage. Aucune autre option — un exécuteur de tests n'a pas de mode dégradé.
- **Aucune écriture** : les suites livrées ouvrent une transaction et l'annulent. L'exécuteur ne
  crée, ne modifie et ne supprime rien par lui-même.

**Contrainte que le contrôle 5 impose aux suites.** Une suite se **termine hors savepoint**, par au
moins une assertion de fond — jamais par une assertion ajoutée pour le compte. La contrainte n'est
pas une commodité d'outillage : une suite qui finit dans un savepoint annulé n'a pas seulement un
compte faux, elle a des preuves finales que pgTAP n'a pas enregistrées.

### 3.3 Sortie

Une ligne par fichier, verte ou rouge, puis un total. Le format reprend celui des
`scripts/verify-*.sh`, afin qu'un lecteur du dépôt n'ait qu'une convention à connaître.

```
  OK    supabase/tests/0001_identite_et_cloisonnement.test.sql — 70 assertions
  OK    supabase/tests/0002_fonctions_autorisation.test.sql — 127 assertions
  OK    supabase/tests/0003_seed_socle.test.sql — 30 assertions

  3 fichiers, 227 assertions, aucune anomalie.
```

### 3.4 Ce que l'exécuteur ne fait pas

Il ne remplace pas les suites pgTAP déjà exécutées par `scripts/verify-migrations.sh`,
`verify-authz.sh` et `verify-seed.sh`. Ces trois scripts sont les preuves de `CRM-003`, `CRM-010`
et `CRM-005` ; les réécrire pour qu'ils délèguent à l'exécuteur mêlerait quatre unités dans un même
commit, contre `CLAUDE.md` §13. La duplication de lecture du TAP est donc **connue et assumée pour
l'instant** ; elle est nommée au §11 comme une limite, non masquée.

## 4. Projets Playwright

### 4.1 Une seule configuration

`e2e/playwright.config.ts` reste l'unique configuration, et déclare les projets. Motif : les trois
projets partagent le fichier `.env` du dépôt comme source de vérité d'environnement, la même
convention de sortie et le même rapport. Trois configurations distinctes tripleraient cette
amorce sans rien isoler d'utile.

### 4.2 `webServer` : mesure et conséquence

Le projet `ui` a besoin de l'application **construite et servie** ; le projet `api` n'en a aucun
besoin — il parle directement à Kong.

**Mesuré** le 2026-08-04, avec `@playwright/test@1.62.1`, au moyen d'un serveur factice écrivant un
marqueur sur disque à son démarrage :

- `playwright test --project=api` → marqueur **présent** : le `webServer` est démarré ;
- `playwright test --project=ui` → marqueur présent ;
- sans filtre → marqueur présent.

Autrement dit, **Playwright démarre le `webServer` pour toute exécution, quel que soit le filtre de
projet**. Laisser la déclaration en l'état ferait donc reconstruire et servir la webapp à chaque
`npm run e2e:api`, pour rien.

Seconde mesure, qui écarte la solution la plus évidente : la configuration est **réévaluée dans
chaque processus worker**, où `process.argv` vaut exactement
`["…/node", "…/workerProcessEntry.js"]`. Le filtre `--project` n'y est **pas visible**. Une
configuration qui déduirait le besoin en lisant `process.argv` fonctionnerait dans le processus
principal et se tromperait dans les workers.

**Décision.** Le besoin est déclaré explicitement par la variable d'environnement `E2E_PROJETS`,
positionnée par le script npm qui lance l'exécution :

- valeur absente → tous les projets sont supposés demandés, donc `webServer` est déclaré. C'est le
  défaut sûr : une invocation directe de `playwright test` continue de fonctionner.
- valeur présente → liste de noms de projets séparés par des virgules. `webServer` n'est déclaré
  que si cette liste contient au moins un projet ayant besoin de l'application servie, c'est-à-dire
  `ui`.

La variable est un **contrat interne** entre `package.json` et la configuration ; elle n'est pas une
variable d'environnement du produit et n'a donc pas sa place dans `.env.example`.

### 4.3 Projet `api` — contrats d'API et refus d'autorisation

**Objet.** Exercer le backend **hors interface**, avec les jetons réels de chaque profil, comme
`CLAUDE.md` §10 l'exige de toute règle d'accès.

**Base d'URL.** Kong, lue depuis `.env` (`KONG_HTTP_PORT`), surchargeable par
`VITE_SUPABASE_URL`. Aucun navigateur n'est lancé : le projet n'utilise que le contexte de requête
de Playwright.

**Prérequis.** La pile de développement démarrée et le seed appliqué. À défaut, les scénarios
échouent avec un message qui nomme la commande manquante — ils ne sont jamais ignorés en silence.

**Fixtures.** Un module `e2e/api/jetons.ts` expose :

- `cleAnonyme` et `cleService`, lues depuis `.env` ;
- `jetonDe(adresse, motDePasse)`, qui obtient un jeton par la **véritable route de connexion**
  (`POST /auth/v1/token?grant_type=password`), jamais par fabrication locale ;
- les trois comptes du seed (`docs/SPEC-seed.md` §2.3) et leur rôle.

C'est cette fixture que `CRM-014` reprendra pour ses douze scénarios : elle est le livrable
durable de ce projet.

**Scénarios livrés par `CRM-008`.** Ils décrivent l'état **réellement mesuré** du produit avant
`CRM-012`, où aucune politique RLS n'existe :

| # | Scénario | Attendu mesuré |
|---|---|---|
| A1 | Requête sans clé `apikey` | `401` à la passerelle |
| A2 | Fonction du schéma `app` appelée par l'API | `404`, code `PGRST202` — le schéma n'est pas exposé |
| A3 | Les tables du socle contiennent réellement des lignes, vu par la clé de service | `profiles` 3, `workspaces` 1, `workspace_members` 3 |
| A4 | Appelant **anonyme** sur ces mêmes tables | `200` et `[]` — preuve n° 11 de `docs/SPEC-permissions-rls.md` §7 |
| A5 | Jeton réel de chacun des **trois** profils seedés | `200` et `[]` |
| A6 | Écriture d'un workspace par un jeton réel | `403`, code PostgreSQL `42501` |

**A3 n'est pas décoratif : il est la condition de validité de A4 et A5.** « Zéro ligne » ne prouve
rien sur une table vide. Le scénario constate donc d'abord, avec la clé de service, que les lignes
existent, puis que personne ne les voit. Les tables `track_members` et `channel_members` sont
**exclues** de A4 et A5 pour cette raison exacte : le seed n'y pose aucune ligne, leur vide ne
démontre aucun refus.

**Ce que ces scénarios deviendront.** A5 et A6 décrivent un produit **sans politiques**. Le jour où
`CRM-012` les livrera, un membre du workspace devra voir son workspace, et A5 échouera. C'est
voulu : l'assertion fige la limite au lieu de la commenter, et son échec forcera à la réviser
plutôt qu'à la laisser survivre à sa cause. C'est la convention déjà retenue par `CRM-006` pour les
types (`docs/SPEC-types.md` §9). Le fichier le dit en toutes lettres, à l'endroit de l'assertion.

**Ce que ces scénarios ne couvrent pas.** Sur les douze preuves de refus, seule la n° 11 est
acquise ici. Les onze autres exigent des cards, des channels, des comptes mail, un second workspace
— rien de tout cela n'existe. `CRM-014` reste donc entière, et sa Definition of Done inchangée.

### 4.4 Projet `ui`

Inchangé quant au fond : les 13 scénarios de `CRM-007`, contre le build de production servi par
`vite preview`. Deux changements de forme seulement — le projet est désormais nommé explicitement
sur la ligne de commande, et `E2E_PROJETS=ui` maintient la déclaration du `webServer`.

### 4.5 Projet `mail`

**Non déclaré.** Voir §2 et §8.

## 5. `npm run e2e:report`

**Mesuré** : le rapporteur `html` de Playwright 1.62.1 produit un unique `index.html` autonome dans
le dossier indiqué ; `playwright show-report <dossier>` le sert sur `http://localhost:9323` et
**reste au premier plan** jusqu'à interruption — vérifié par un `curl` rendant `200` pendant qu'il
tourne.

Conséquences retenues :

- le rapporteur `html` est ajouté à côté de `list`, avec `open: 'never'` : une commande de test ne
  doit pas tenter d'ouvrir un navigateur, encore moins sur une machine sans affichage ;
- la sortie va dans `e2e/report/`, ignoré par git au même titre que `e2e/output/` — un rapport est
  une pièce de diagnostic, pas un livrable versionné ;
- `npm run e2e:report` sert le **dernier** rapport produit. Chaque exécution écrase le précédent :
  c'est le comportement de Playwright, il est documenté ici plutôt que contourné.

## 6. Vitest

Aucun changement. `npm run test:unit` est livré et prouvé par `CRM-007`. `CRM-008` se borne à le
faire figurer dans le tableau des commandes et à vérifier, dans son harnais, qu'un test
volontairement faux le fait bien échouer — ce que la Definition of Done exige de **chaque** famille
de tests, pas seulement des nouvelles.

## 7. Preuves attendues

`scripts/verify-harness.sh` rejoue, sur une pile de développement démarrée et seedée :

1. **`npm run test:sql`** est vert et exécute les trois suites, pour le nombre d'assertions attendu.
2. **`npm run e2e:api`** est vert, et couvre les six scénarios du §4.3.
3. **`npm run e2e:ui`** reste vert : le renommage du projet et la variable `E2E_PROJETS` n'ont rien
   cassé.
4. **`npm run test:unit`** reste vert.
5. **`npm run e2e:report`** sert réellement le dernier rapport : le processus est lancé, interrogé
   en HTTP, et le code `200` est constaté avant qu'il soit arrêté.
6. **`npm run e2e:api` ne démarre pas de serveur web**, mesuré et non supposé : aucun processus
   `vite preview` n'apparaît pendant son exécution, et `webapp/dist` n'est pas réécrit.
7. **Compilation** : `npm run typecheck` reste vert, les nouveaux fichiers `e2e/` étant couverts par
   `tsconfig.tools.json`.
8. **Non-complaisance**, éprouvée en dégradant réellement le monde, puis en le restaurant :
   - une **assertion volontairement fausse** insérée dans une suite pgTAP réelle fait échouer
     `npm run test:sql` ;
   - un **plan tronqué** — `finish()` retiré — le fait échouer aussi, ce qui prouve que l'exécuteur
     ne se contente pas du diagnostic de pgTAP ;
   - une **erreur SQL** le fait échouer ;
   - une **politique RLS permissive** réellement posée sur `workspaces` pour `anon` fait échouer
     `npm run e2e:api` : c'est la preuve que le projet `api` détecte une régression d'autorisation,
     et non qu'il constate une base vide ;
   - un **test unitaire volontairement faux** fait échouer `npm run test:unit`.
9. **Restauration constatée** : la politique posée est retirée, l'absence de toute politique
   résiduelle est vérifiée en base, et les fichiers altérés sont identiques à leur version
   versionnée — constaté, pas supposé.

## 8. Ce qui reste dû, et par qui

| Commande | Bloquée par | Ce qui manque exactement |
|---|---|---|
| `pytest mail-sync/tests` | `CRM-051` | Aucun code Python dans le dépôt. Un harnais pytest sans sujet rendrait `5` (« no tests ran ») ou, pire, `0` sur un périmètre vide. |
| `npm run e2e:mail` | `CRM-050`, `CRM-054` | Ni Stalwart, ni boîte, ni ingestion : rien à faire circuler. |

Les onze preuves de refus restantes de `docs/SPEC-permissions-rls.md` §7 restent dues par
`CRM-014`, qui s'appuiera sur les fixtures livrées ici.

## 9. Commandes

| Commande | Effet | Prérequis |
|---|---|---|
| `npm run test:sql` | exécute les suites pgTAP de `supabase/tests/` | pile démarrée |
| `npm run test:unit` | Vitest, webapp | aucun |
| `npm run e2e:api` | Playwright, projet `api` — contrats et refus, hors interface | pile démarrée, seed appliqué |
| `npm run e2e:ui` | Playwright, projet `ui` — parcours et captures | pile démarrée |
| `npm run e2e:report` | sert le dernier rapport HTML | une exécution E2E préalable |
| `scripts/verify-harness.sh` | rejoue l'ensemble des preuves de l'unité | pile démarrée, seed appliqué |

## 10. Limites connues

- **`pytest` et `e2e:mail` ne sont pas livrés** (§2, §8). `CRM-008` reste `[~]` tant qu'INC-023
  n'est pas arbitrée.
- **Sur les douze preuves de refus, une seule est acquise** — la n° 11. Les autres n'ont pas encore
  de sujet.
- **La lecture du TAP est dupliquée** : l'exécuteur la porte, et trois `scripts/verify-*.sh`
  gardent la leur (§3.4). Unifier reviendrait à modifier les preuves de trois autres unités dans ce
  commit.
- **`E2E_PROJETS` doit rester cohérente avec `--project`.** Rien ne peut le vérifier depuis la
  configuration, puisque le filtre n'est pas visible des workers (§4.2). Une incohérence ne rend
  aucun résultat faux : elle démarre un serveur inutile, ou en omet un — auquel cas les scénarios
  `ui` échouent bruyamment sur une connexion refusée.
- **Les scripts npm positionnent la variable en syntaxe POSIX.** Le dépôt cible Linux et Docker
  (`README.md` §3) ; aucun support Windows natif n'est prétendu.
- **Un seul navigateur** pour le projet `ui` : Chromium, comme depuis `CRM-007`.
- **Le projet `api` ne couvre pas Realtime ni Storage.** Ce sont des contrats d'API, ils entreront
  dans le harnais avec les unités qui les emploient.
