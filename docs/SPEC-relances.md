# Spécification — cards figées et relances automatiques

Contrat exécutable de `CRM-062` (`docs/BACKLOG.md`, chunk 5).

- Unité de backlog : `CRM-062`.
- Modèle : `docs/SCHEMA.md` §5 (`cards`), §4 (`workflow_nodes_catalog`, `workflow_steps`).
- Règles d'autorisation : `docs/SPEC-permissions-rls.md` §3.7 (`app.can_read_card`).
- Ordonnancement : `docs/SPEC-scheduler.md` (`CRM-017`).
- Interface existante qui porte déjà la notion : `docs/SPEC-workflow-engine.md` §7.4 (pastille
  d'ancienneté du board), `docs/DESIGN_SYSTEM.md` §5.1.
- Manuel : `docs/manual.md` chapitre **`3 quinquies`**, immédiatement après `3 quater` « Ma
  journée ». *Cette ligne écrivait « chapitre 30 » depuis la tranche 1 ; ce chapitre n'existe pas et
  ne peut pas exister — le manuel numérote de 1 à 6 avec des suffixes latins. Corrigé le 2026-08-24,
  motif au §10.13, écart consigné au registre.*
- Ordonnanceur livré dont la tranche 2 réemploie le mécanisme : `docs/SPEC-scheduler.md` §3
  (démarrage observable), §4 (fermeture des privilèges), §5 (convergence).
- État : **tranche 1 livrée** (§1 à §6), **tranche 2 livrée** (§9), **tranche 3 spécifiée au §10**
  le 2026-08-24 après mesure sur la pile debout et seedée, avant sa première ligne de code. Elle se
  découpe en trois sous-tranches — **3a** le jeu de démonstration, **3b** la relance nommée dans le
  fil, **3c** l'écran.

---

## 1. Intention, et la frontière que cette unité ne franchit pas

Un CRM ne sert à rien s'il faut se souvenir soi-même de ce qui dort. `CRM-062` livre la notion de
**card figée** — une affaire restée dans son étape au-delà du seuil de relance de cette étape — et
la **relance automatique** qui la fait remonter sans que personne ait à la chercher.

**Ce que cette unité NE fait PAS, et qui appartient nommément à d'autres :**

| Hors périmètre | Unité qui le porte |
|---|---|
| Modèles d'emails, signatures, **séquences** de relance à plusieurs paliers | `CRM-063` |
| Notification temps réel, préférences de notification | `CRM-064` |
| Score de santé (`cards.health_score`) et prévisionnel pondéré | `CRM-066` |
| Digest quotidien par email | `CRM-069` |

Une relance de `CRM-062` **ne part pas par email**. Elle est un fait inscrit dans le produit, que
l'utilisateur rencontre en ouvrant son CRM. Faire partir un email suppose un modèle, un expéditeur
et une cadence, c'est-à-dire exactement les trois objets que `CRM-063` porte et qu'aucune table ne
tient aujourd'hui — l'inventer ici serait la « valeur par défaut trompeuse » que `CLAUDE.md` §18
proscrit.

## 2. Ce qu'une card figée est — la règle, écrite une seule fois, et en base

### 2.1 Pourquoi la règle descend en base, alors que l'écran la calcule déjà

`webapp/src/lib/board.ts` calcule depuis `CRM-041` un booléen `ancienneteDepassee`, qui allume la
pastille `danger` du §7.4. Cette règle vit donc aujourd'hui **dans un composant d'interface**, et
elle y est correcte. Elle n'y est pas *suffisante* :

1. `CLAUDE.md` §10 : « visible », « remonté », « à relancer » sont des règles de produit, et une
   règle de produit s'applique là où l'interface ne peut pas être contournée ;
2. une relance **automatique** s'exécute sans navigateur : l'ordonnanceur du `CRM-017` n'a pas de
   `board.ts` ;
3. un écran qui listerait les affaires figées devrait sinon **télécharger toutes les cards** pour en
   écarter la quasi-totalité côté client, ce que `CLAUDE.md` §21 interdit dès que le volume croît.

La règle est donc écrite **une fois**, en SQL, et l'écran de la tranche 3 la **lira** au lieu de la
recalculer. La pastille du board n'est pas retirée pour autant : elle qualifie une carte déjà
téléchargée pour une autre raison, et la faire dépendre d'un second aller-retour serait une
régression. Les deux définitions doivent rester **identiques**, et le §6 exige une preuve qui les
compare sur la donnée réelle.

### 2.2 Le seuil effectif

Le seuil de relance d'une card est celui de l'**étape où elle se trouve** :

```
seuil_effectif = coalesce(workflow_steps.stale_after_days,
                          workflow_nodes_catalog.default_stale_after_days)
```

C'est exactement la résolution du §3.3 de `docs/SPEC-workflow-engine.md` et celle de
`resoudreEtape` dans `board.ts`. **Un seuil absent n'est jamais remplacé par un seuil par défaut** :
une étape sans seuil est une étape dont personne n'a dit au bout de combien de temps elle est en
retard, et l'inventer serait une règle de produit que nul n'a prise (§7.4, déjà tranché par
`CRM-041`). Une card sur une telle étape n'est **jamais** figée.

**MESURÉ le 2026-08-24 sur le catalogue seedé** — les huit nœuds et leur seuil :

| Clé | `kind` | `default_stale_after_days` |
|---|---|---|
| `prospection` | `open` | 14 |
| `relance` | `open` | 7 |
| `negociation` | `open` | 10 |
| `signature` | `open` | 7 |
| `realisation` | `open` | 30 |
| `livre` | `won` | *(nul)* |
| `perdu` | `lost` | *(nul)* |
| `qualification` | `open` | 21 *(archivé)* |

Une seule étape du workflow seedé surcharge son seuil : `Négociation`, à **5** jours contre 10 au
catalogue (`docs/SPEC-workflow-engine.md` §7.4, tableau des étapes). La surcharge est donc exercée
par le seed, et non seulement décrite.

### 2.3 Les nœuds terminaux ne sont PAS nommés par la règle, et c'est une décision

Une card « Livré » ou « Perdu » n'est pas relancée. Il eût été possible de l'écrire —
`kind not in ('won', 'lost')` — et **ce n'est délibérément pas fait** : les deux nœuds terminaux du
catalogue ne portent **aucun** seuil, donc la règle du §2.2 les écarte déjà, et ajouter une seconde
condition qui dit la même chose créerait **deux** définitions de « terminal » à maintenir.

La conséquence est nommée plutôt que masquée : un administrateur qui poserait un seuil de relance
sur un nœud terminal rendrait ses cards relançables. C'est un choix que l'écran d'administration du
catalogue lui laisse (`CRM-030`, §2.5 : le seuil est libre sur tout nœud), et le produit l'honore au
lieu de le contredire en silence. **Figé par une assertion** (§6, ligne *k*), afin que le jour où
cette liberté devient gênante, la preuve le dise plutôt qu'un utilisateur.

### 2.4 Les trois exclusions, chacune mesurée

Sont exclues, quel que soit leur âge :

| # | Exclusion | Prédicat | Motif |
|---|---|---|---|
| 1 | **archivée** | `archived_at is null` | une affaire rangée n'est pas en retard, elle est rangée |
| 2 | **en corbeille** | `deleted_at is null` | `CRM-077` : une card en corbeille est sortie du produit |
| 3 | **en sommeil** | `snoozed_until is null or snoozed_until <= now()` | `CRM-081` §16.2 : mettre en sommeil est précisément le geste qui dit « pas maintenant ». Relancer une card endormie annulerait le seul geste que l'utilisateur a posé contre les relances |

Le prédicat de sommeil est **exactement** celui de `estEnSommeil`
(`webapp/src/lib/sommeil-card.ts`, §16.2) : non nul **et strictement postérieur** à l'instant de
lecture. Une échéance de sommeil **échue** ne protège plus — la card est réveillée de fait, et le
seed en porte le cas.

**MESURÉ le 2026-08-24**, sonde créée puis détruite, chaque card vieillie de quatre-vingt-dix jours
dans une transaction annulée :

| Card vieillie de 90 jours | Rendue figée ? |
|---|---|
| « Contrat cadre 2025 » — archivée | **non** |
| « Saisie erronée » — en corbeille | **non** |
| « Cadrage data — Groupe Vallier » — `snoozed_until` **future** | **non** |
| « Refonte du site vitrine » — `snoozed_until` **échue** | **oui** |
| « Socle analytique — Vertuo » — étape `Livré`, sans seuil | **non** |

La quatrième ligne n'est pas un défaut : elle est la mesure qui distingue « endormie » de « a été
endormie ».

### 2.5 La borne, et l'unité de compte

L'ancienneté se compte en **jours révolus**, et le dépassement est **large** :

```
jours_dans_etape = floor(extract(epoch from (now() - entered_step_at)) / 86400)
figee            = jours_dans_etape >= seuil_effectif
```

C'est, au caractère près, ce que `evaluerAnciennete` calcule dans `board.ts` — `Math.floor` sur des
millisecondes, comparaison `>=`. Écrire `>` en base ferait diverger la pastille et la relance d'une
journée entière, et personne ne saurait laquelle a raison.

**MESURÉ**, transaction annulée, sur « Contrat TMA 2026 — Mairie de Vaulx » (seuil 7) :

| `entered_step_at` | `jours_dans_etape` | figée ? |
|---|---|---|
| `now() - 7 jours` | 7 | **oui** — la borne est atteinte |
| `now() - 7 jours + 1 heure` | 6 | **non** |

### 2.6 Ce que la règle NE regarde pas

`next_action_at` n'entre pas dans la définition. Une échéance de prochaine action dépassée est le
sujet de `CRM-061` et de la vue « Ma journée » ; une card figée est une card qui n'a **pas bougé
d'étape**. Les deux se recoupent souvent et ne sont pas la même chose : une affaire peut porter une
prochaine action à demain et dormir dans son étape depuis six semaines.

## 3. `public.cards_figees()` — le contrat

### 3.1 Signature

```sql
public.cards_figees() returns table (
  card_id           uuid,
  workspace_id      uuid,
  channel_id        uuid,
  title             text,
  owner_id          uuid,
  step_id           uuid,
  entered_step_at   timestamptz,
  seuil_jours       integer,
  jours_dans_etape  integer,
  retard_jours      integer
)
```

`retard_jours = jours_dans_etape - seuil_jours`, donc **toujours positif ou nul** par construction :
la ligne n'existe que si la borne est atteinte. Il est rendu plutôt que laissé à calculer, parce
qu'il est la seule grandeur que l'écran de la tranche 3 classe et que l'utilisateur lit.

**Aucun libellé d'étape n'est rendu**, et c'est la règle de `card_events` (§14.6 de
`docs/SPEC-cards.md`) : une fonction qui recopierait le libellé dirait demain ce qui était vrai
aujourd'hui. L'appelant qui veut un libellé lit `workflow_steps` par `step_id`.

### 3.2 Volatilité, `search_path`, et pourquoi elle n'est PAS `security definer`

| Propriété | Valeur | Motif |
|---|---|---|
| `language` | `sql` | aucune branche, aucune boucle |
| Volatilité | `stable` | elle lit `now()` et ne modifie rien |
| `search_path` | `''` | tous les objets qualifiés, comme les sept fonctions du §3 de `docs/SPEC-permissions-rls.md` |
| `security` | **invoker** | c'est le point : la RLS de `cards` s'applique à l'appelant |

`security definer` aurait rendu à chacun les cards de tout le monde. En `invoker`, la fonction
n'ajoute **aucune** règle d'accès : elle hérite de `app.can_read_card`, donc des droits fins de
`CRM-012`. Le refus est mesuré comme **zéro ligne**, jamais comme une erreur — c'est la forme exigée
par la preuve de refus n° 4 (`docs/SPEC-permissions-rls.md` §7).

### 3.3 Autorisations

`execute` est révoqué de `public` **et d'`anon` nommément**, puis accordé à `authenticated` et
`service_role` — exactement l'ACL mesurée de `public.etat_messagerie` et de
`public.previsualiser_exigence`.

`anon` n'a **aucun** privilège d'exécution : un appelant anonyme est refusé par le **privilège**,
avant toute politique, et PostgREST rend `401` / `42501`. C'est plus strict qu'une politique qui
rendrait un tableau vide, et c'est ce que les deux fonctions jumelles font déjà.

**RÉVOQUER `public` NE SUFFIT PAS, ET C'EST MESURÉ.** La première écriture de la migration ne
révoquait que `public` ; l'appelant anonyme obtenait alors `200` et `[]`, non `401`. La cause est
dans la plateforme : `pg_default_acl` porte
`alter default privileges in schema public … on functions to anon`, si bien que **toute fonction
neuve de `public` naît avec `anon=X`**, et `revoke … from public` ne retire rien à un rôle **nommé**.
C'est le point de sûreté que les migrations 48 à 52 nomment pour les tables, et il vaut pour les
fonctions : `public.etat_messagerie` révoque `public, anon` depuis la migration 31 pour cette raison
exacte. La suite pgTAP fige l'ACL rôle par rôle, afin qu'une prochaine fonction ne refasse pas
l'erreur en silence.

### 3.4 Ordre

`order by retard_jours desc, title asc`. Le retard décroissant est le seul ordre que la donnée
porte et que l'utilisateur attend ; le titre départage, afin que deux applications successives
rendent la **même** suite — `id` ne serait pas lisible, et `entered_step_at` répéterait le retard.

## 4. Contrat d'API, à mesurer sur la pile réelle

Appel : `POST /rest/v1/rpc/cards_figees` (aucun argument). Les jetons sont ceux des trois profils
seedés.

| # | Appelant | Appel | Attendu |
|---|---|---|---|
| a | `admin` | `rpc/cards_figees` | `200`, **1** ligne : `5eed…00c3` |
| b | `admin` | ligne *a* | `seuil_jours = 14`, `jours_dans_etape = 30`, `retard_jours = 16` |
| c | `admin` | ligne *a* | `title = 'Audit sécurité applicative'`, `owner_id` non nul, `step_id` = l'étape `Prospection` du workflow du channel `grands-comptes` |
| d | `business_developer` | `rpc/cards_figees` | `200`, **1** ligne, la même : le track lui est ouvert |
| e | `viewer` | `rpc/cards_figees` | `200`, **`[]`** — le track `grands-comptes` lui est fermé (`CRM-012`). **Zéro ligne, pas une erreur** |
| f | anonyme | `rpc/cards_figees` | `401`, `42501` — refusé par le **privilège**, avant toute politique |
| g | `admin` | `GET` sur la même route | `200`, la même ligne : la fonction est `stable`, donc PostgREST l'expose aussi en lecture |
| h | `admin` | `rpc/cards_figees?select=card_id,retard_jours` | `200`, la ligne **projetée sur les deux colonnes demandées** |
| i | `admin` | `rpc/cards_figees?retard_jours=gt.20` | `200`, `[]` : le filtre s'applique **après** la fonction, sur ses colonnes de sortie |
| j | `viewer` | la card `…00c3` par `GET /cards?id=eq.…` | `200`, `[]` — contre-épreuve de la ligne *e* : c'est bien la RLS, et non la fonction, qui refuse |

**Les dix lignes sont MESURÉES le 2026-08-24**, migration appliquée, jetons obtenus par la véritable
route `POST /auth/v1/token?grant_type=password`. Deux prédictions ont été corrigées **par la
mesure**, jamais le test relâché :

- la ligne *g* annonçait `404` en se contredisant dans sa propre justification ; PostgREST expose
  bien une fonction `stable` en `GET`, et elle rend `200` ;
- la ligne *f* annonçait `401` et rendait `200 []` : c'est le défaut de privilège corrigé au §3.3,
  et la ligne est donc rétablie telle qu'elle était écrite, **après** correction du produit — non
  l'inverse.

## 5. Ce que le seed démontre, et ce qu'il ne démontre pas encore

Le §9.12 de `docs/SPEC-seed.md` a posé, pour `CRM-046` tranche 3, **exactement une** card au-delà de
son seuil : `5eed0000-0000-4000-8000-0000000000c3`, « Audit sécurité applicative », trente jours
dans une étape de seuil quatorze. Cette unité **n'y touche pas** : son contrat est déjà écrit,
mesuré, et tenu par `scripts/verify-board.sh` avec sa contre-épreuve.

**MESURÉ le 2026-08-24**, seed appliqué, sur les 41 cards du jeu (39 actives) :

| Appelant | Lignes rendues |
|---|---|
| `admin` | 1 |
| `business_developer` | 1 |
| `viewer` | 0 |
| `anon` | 0 (et refusé par le privilège à travers PostgREST) |

**Une seule ligne suffit à la tranche 1** et ne suffira **pas** à la tranche 3 : un écran qui liste
les affaires figées et n'en montre qu'une ne démontre ni son classement par retard, ni son
regroupement. Le §7.3 dit ce que le seed devra alors poser, et **cette dette est nommée ici plutôt
que découverte à l'écriture de l'écran**.

## 6. Preuves exigées de la tranche 1

| Niveau | Preuves attendues |
|---|---|
| pgTAP | Existence, signature exacte et type de retour ; `stable`, `search_path` vide, **non** `security definer` ; ACL — `anon` sans `execute`, `authenticated` et `service_role` avec ; les trois exclusions du §2.4 mesurées **dans les deux sens**, chacune par vieillissement en transaction annulée ; la borne du §2.5 des deux côtés ; le seuil surchargé par l'étape l'emporte sur celui du nœud ; seuil nul ⇒ jamais figée ; `retard_jours` cohérent ; l'ordre du §3.4 ; conformité du seed — exactement une ligne, et c'est `…00c3` ; ligne *k* : un seuil posé sur un nœud terminal rend ses cards relançables (§2.3) |
| API | Les dix lignes du contrat du §4, avec les jetons réels des trois profils seedés, chaque refus **relisant la donnée** pour la constater inchangée |
| Unitaire (webapp) | Aucun : la tranche 1 ne touche aucun module de la webapp |
| E2E d'interface | **Aucun** : la tranche 1 ne livre aucun écran. L'absence est nommée, elle n'est pas compensée par une preuve de substitution |
| Visuel | **Aucun**, pour la même raison |
| Cohérence | La règle SQL et `evaluerAnciennete` de `board.ts` rendent le **même** verdict sur les 39 cards actives du seed — comparaison exécutée par le harnais, sur la donnée réelle |

Le harnais dédié est `scripts/verify-relances.sh`, non complaisant : chacune des trois exclusions du
§2.4 est **réellement retirée** de la fonction, la suite doit rougir, et la restauration est
**constatée** et non supposée.

## 7. Les tranches, et ce que la tranche 1 ne livre pas

### 7.1 Tranche 1 — la règle en base *(cette tranche)*

Migration `0053`, la fonction du §3, sa suite pgTAP, son contrat d'API, son harnais.
**Aucun écran, aucune relance automatique, aucun ordonnanceur.**

### 7.2 Tranche 2 — la relance automatique

Un job `pg_cron` quotidien, enregistré par migration sous un nom stable comme l'exige
`docs/SPEC-scheduler.md` §5, qui inscrit dans la timeline de chaque card devenue figée un événement
`card_events` de type **`stalled`** — quinzième valeur du `card_events_type_check`, à ajouter par
la même migration.

Ses trois propriétés — idempotence, acteur nul, `payload` sans libellé — **sont désormais
spécifiées, et elles le sont au §9**, écrit après mesure sur la pile réelle le 2026-08-24. Ce §7.2
n'en est plus que le sommaire.

### 7.3 Tranche 3 — la surface

L'écran qui liste les affaires figées de l'appelant, son entrée de navigation, le chapitre
`3 quinquies` du manuel, les captures aux quatre paliers, et **l'extension du seed** que le §5 a
nommée : une seule card figée ne démontre ni classement, ni regroupement.

Ce §7.3 n'est plus qu'un sommaire : la tranche est **spécifiée au §10**, écrit après mesure sur la
pile réelle le 2026-08-24, et elle s'y découpe en **trois** sous-tranches — le jeu de démonstration,
la relance nommée dans le fil, puis l'écran.

## 8. Points ouverts

Aucun arbitrage n'est demandé par la tranche 1 ni par la tranche 2. Les trois propriétés annoncées
au §7.2 sont spécifiées au §9, **avant** la première ligne de la tranche 2 et non pendant.

---

## 9. Tranche 2 — la relance automatique, contrat exécutable

Chapitre écrit le **2026-08-24**, après mesure sur la pile de développement debout et seedée, et
**avant** la première ligne de la migration `0054`. Chaque valeur citée ici a été relevée sur cette
pile ; aucune ne vient d'un souvenir.

### 9.1 Ce que la tranche livre, et la frontière qu'elle ne franchit pas

La tranche 1 a rendu la notion de card figée **lisible** en base. Elle ne la rend pas encore
**agissante** : personne n'est prévenu tant que personne n'appelle la fonction. La tranche 2 livre
le geste qui manque — une inscription, quotidienne et automatique, dans la mémoire de l'affaire.

| Dans le périmètre | Hors périmètre, et l'unité qui le porte |
|---|---|
| Un job `pg_cron` quotidien, nommé, enregistré par migration | Toute cadence configurable par l'utilisateur — `CRM-063` |
| Un événement `card_events` de type `stalled` par *entrée dans l'étape* | Tout email, tout modèle, toute séquence — `CRM-063` (§1) |
| La quinzième valeur du `card_events_type_check` | Toute notification temps réel ou préférence — `CRM-064` |
| L'extension du seed qui rend la relance visible en développement | L'écran qui liste les affaires figées — tranche 3 (§7.3) |

**Une relance de `CRM-062` ne part pas par email**, et le §1 dit pourquoi : un email suppose un
modèle, un expéditeur et une cadence, c'est-à-dire les trois objets de `CRM-063` qu'aucune table ne
tient. Elle est **un fait inscrit dans le produit**, que l'utilisateur rencontre en ouvrant la
timeline de son affaire.

### 9.2 La règle n'est PAS réécrite : le job appelle `public.cards_figees()`

Le job ne redérive aucun prédicat. Il appelle la fonction de la tranche 1, et c'est la condition
pour que « figée » garde **une seule définition en base** — l'exigence du §2.1, qui perdrait tout
son sens si la tranche 2 recopiait le `where` de la migration 53.

Cela suppose que la fonction, appelée par l'ordonnanceur, voie **toutes** les affaires et non
celles d'un appelant. `public.cards_figees()` est `security invoker` (§3.2) : elle voit ce que voit
son appelant. **MESURÉ le 2026-08-24 :**

```
select rolbypassrls, rolsuper from pg_roles where rolname = 'postgres';
 rolbypassrls | rolsuper
--------------+----------
 t            | f
```

`postgres` — le rôle sous lequel `pg_cron` exécute la commande, comme le heartbeat de `CRM-017`
(`docs/SPEC-scheduler.md` §3) — porte `BYPASSRLS`. Appelée par lui, la fonction rend donc
l'ensemble global. Mesuré sur le seed : `1` ligne pour `postgres`, la card `5eed…00c3`, celle-là
même que la lectrice ne voit pas (`0` ligne pour `viewer`, §5).

**Ce n'est pas une élévation de privilège cachée** : la fonction n'a pas changé, et aucun rôle
client n'a gagné quoi que ce soit. C'est le rôle d'exploitation qui voit tout, comme il voit déjà
tout par `select * from public.cards`.

### 9.3 `app.relancer_cards_figees()` — le contrat

| Propriété | Valeur | Motif |
|---|---|---|
| Schéma | `app` | Objet privé d'exploitation, comme `app.scheduler_heartbeat_tick()` (`docs/SPEC-scheduler.md` §2) |
| Signature | `app.relancer_cards_figees() returns integer` | Rend le **nombre d'événements réellement inscrits** — grandeur que le seed, la suite pgTAP et le harnais lisent au lieu de la déduire |
| `language` | `plpgsql` | Une insertion ensembliste, un compte, une promotion de cadence |
| Volatilité | `volatile` | Elle écrit |
| `security` | **definer**, propriétaire `postgres` | Aucun rôle ne détient `INSERT` sur `card_events` (§14.7 de `docs/SPEC-cards.md`) ; c'est la même raison qu'aux six triggers de la timeline |
| `search_path` | `''` | Tous les objets qualifiés, règle générale des fonctions `definer` du dépôt |
| Privilèges | `revoke execute` de `public`, `anon`, `authenticated`, `service_role` | Aucun client ne déclenche une relance. Même fermeture que `app.scheduler_heartbeat_tick()` (`docs/SPEC-scheduler.md` §4) |

**Elle n'est exposée par aucune route.** Elle vit dans `app`, schéma que PostgREST n'expose pas.
Un client qui voudrait « forcer les relances » n'a pas de bouton, et c'est voulu : la relance est
un fait de l'horloge, pas un geste d'utilisateur.

### 9.4 Propriété 1 — l'idempotence, ancrée sur `entered_step_at`

Une card figée depuis six semaines ne doit pas recevoir quarante-deux événements. L'ancrage est
**l'entrée dans l'étape** : *au plus un `stalled` par entrée dans une étape*.

Le prédicat, écrit une fois :

```sql
not exists (
  select 1
    from public.card_events e
   where e.card_id    = f.card_id
     and e.type       = 'stalled'
     and e.created_at >= f.entered_step_at
)
```

Trois conséquences, et chacune est voulue :

1. **Le rejeu du même jour n'écrit rien.** Le second passage voit l'événement du premier.
2. **Tout `move_card` réarme la relance**, sans qu'aucune ligne de code ne le prévoie : `move_card`
   repose `entered_step_at` à l'instant du déplacement, qui devient donc postérieur à l'événement
   précédent. Une affaire qui repasse par une étape déjà relancée sera relancée de nouveau, et
   c'est le comportement attendu — elle y dort une **seconde** fois.
3. **Aucune colonne n'est inventée pour tenir l'état.** L'ancre est la timeline elle-même, table
   dont l'immuabilité est déjà prouvée (`docs/SPEC-cards.md` §14). Une colonne `last_stalled_at`
   sur `cards` aurait créé une seconde source de vérité à maintenir en cohérence avec la première.

**Pourquoi `created_at >= entered_step_at` et non une égalité stockée dans le `payload`.** La borne
large suffit et ne dépend d'aucune donnée recopiée. Elle repose sur un fait de la table :
`created_at` est posé par `clock_timestamp()` au moment de l'écriture (§14.3), donc toujours
postérieur à l'entrée dans l'étape qui l'a rendue possible. **MESURÉ sur le seed**, où
`entered_step_at` est antidatée de trente jours par la fixture — cas le plus défavorable, puisque
l'antidatage éloigne l'ancre du présent :

```
entered_step_at = 2026-07-25 20:17:44+00     (antidatée par le seed)
created (évén.) = 2026-08-24 20:17:42+00     (écrit à l'application du seed)
```

Aucun `stalled` n'existe encore sur cette card ; le prédicat rend donc `1` ligne à inscrire, et
zéro au passage suivant.

### 9.5 Propriété 2 — l'acteur est nul, et ce n'est pas une affectation

`actor_id` est **nul**. Une relance automatique n'a pas d'auteur humain, et lui en inventer un —
l'assignataire, l'administrateur, le dernier acteur — serait la « valeur par défaut trompeuse »
que `CLAUDE.md` §18 proscrit.

Cette nullité n'est pas écrite : elle est **obtenue**. L'écriture passe par
`app.card_event_ecrire()`, seule voie d'écriture de la table (§14.5), qui pose
`(select p.id from public.profiles p where p.id = auth.uid())`. **MESURÉ le 2026-08-24**, dans une
session `psql` sous `postgres`, exactement le contexte du job :

```
select coalesce(auth.uid()::text, 'NULL');
 NULL
```

Aucune revendication JWT n'existe hors d'une requête PostgREST : `auth.uid()` rend `NULL`, la
sous-requête rend `NULL`, l'événement est attribué à personne. C'est le point 2 du §14.5, déjà
constaté pour la clé de service, et la tranche 2 ne fait que s'y conformer.

### 9.6 Propriété 3 — le `payload`, deux nombres et aucun libellé

```json
{ "seuil_jours": 14, "retard_jours": 16 }
```

Le seuil effectif et le retard **au moment de l'inscription**, tels que
`public.cards_figees()` les rend, et rien d'autre.

**Aucun libellé d'étape, aucun titre de card, aucun nom de responsable.** C'est la règle du §14.6 :
un `payload` qui recopierait un libellé dirait demain ce qui était vrai aujourd'hui. Le lecteur du
fil qui veut le nom de l'étape le lit dans `workflow_steps`, où il est à jour.

**Aucun `step_id` non plus**, et c'est une décision plutôt qu'un oubli : l'étape concernée est
celle où la card se trouvait à l'instant de l'inscription, et la timeline la porte déjà — le
`moved` (ou le `created`) qui précède immédiatement le `stalled` la nomme. Ajouter `step_id`
dupliquerait une information que l'ordre du fil donne déjà.

Le retard est conservé **parce qu'il n'est pas recalculable après coup** : il dépend de `now()` au
moment du passage, et une lecture faite trois semaines plus tard rendrait un autre nombre. Le
seuil l'accompagne parce qu'un retard sans son seuil ne se lit pas.

### 9.7 Le job `pg_cron`

`docs/SPEC-scheduler.md` §1 l'annonce : « chacune de ces unités enregistrera son propre job
`pg_cron` par migration ». Le contrat, dans la forme mesurée du heartbeat :

| Propriété | Valeur |
|---|---|
| Nom | `p2enjoy-relances-cards-figees` |
| Base / rôle | `postgres` / `postgres` |
| Commande | `select app.relancer_cards_figees();` |
| Cadence d'amorçage | `10 seconds` |
| Cadence nominale | `23 3 * * *` — une fois par jour, à 03 h 23 UTC |
| État | actif |

**Une fois par jour, et non par heure.** Le retard se compte en jours révolus (§2.5) : un passage
horaire produirait vingt-quatre évaluations pour une frontière qui ne bouge qu'une fois. L'heure
creuse évite de disputer les ressources aux passages interactifs, et la minute `23` la partage avec
le heartbeat, qui occupe la minute `7`.

**Le démarrage observable est celui du §3 de `docs/SPEC-scheduler.md`, et il est repris tel quel.**
Un job quotidien serait autrement invérifiable : une preuve froide attendrait jusqu'à vingt-quatre
heures son premier passage. La cadence d'amorçage de dix secondes est donc **transitoire** — le
premier passage inscrit ce qu'il doit, puis appelle `cron.alter_job` **dans la même transaction**
pour revenir à la cadence quotidienne. Si la promotion échoue, le passage entier échoue et
`cron.job_run_details` le dit ; aucune relance à demi écrite ne subsiste.

Ce mécanisme est **exactement** celui que `CRM-017` a livré et prouvé ; la tranche 2 ne le
réinvente pas, elle l'applique.

### 9.8 La quinzième valeur du vocabulaire

`card_events_type_check` porte quatorze valeurs depuis la migration `0044`. `stalled` est la
quinzième, et elle est ajoutée **par la même migration que la fonction qui l'écrit** — la règle du
§14.4, éprouvée par `CRM-045` puis par `CRM-081`.

**Le mécanisme tient encore, et c'est MESURÉ le 2026-08-24**, avant la migration `0054` :

```
select app.card_event_ecrire('5eed…00c3', …, 'stalled', '{}');
=> SONDE: stalled REFUSE par le CHECK (23514)
```

La base refuse une valeur que rien ne produit. C'est la troisième occurrence constatée de cette
garde, et elle est relevée ici plutôt que supposée.

La contrainte est **remplacée** — jamais « ajoutée si absente » —, dans la forme convergente des
migrations `0030` et `0044` : si la définition courante ne cite pas `stalled`, elle est déposée et
réécrite avec les quinze valeurs. Un rétrécissement manuel est ainsi réparé, non constaté.

**CE QU'UNE QUINZIÈME VALEUR EXIGE DES MIGRATIONS ANTÉRIEURES, et que la tranche 2 avait manqué —
INC-210, MESURÉ le 2026-08-25.** Une migration qui converge le vocabulaire porte **deux** gardes
(INC-144) : la première regarde la contrainte, la seconde regarde les **lignes** et lui interdit de
converger si l'une d'elles porte un type qu'elle ne connaît pas. Les migrations `0020`, `0025` et
`0030` les portent toutes deux ; la `0044` n'avait que la première. Tant que ses quatorze valeurs
étaient les plus larges du dépôt, l'omission était inerte — poser la quinzième l'a rendue
bloquante : sur une base dont la contrainte a été réduite, la `0044` tentait de reposer un
vocabulaire que les quatre lignes `stalled` du seed violent, le `migrations-runner` s'arrêtait en
`23514` avec le code 3, et **les migrations `0045` à `0054` ne s'appliquaient plus du tout**.

La seconde garde est donc posée sur la `0044`, dans la forme exacte des trois autres. La `0054`
reste seule responsable d'installer les quinze valeurs, ce que sa propre garde — qui ne regarde que
`stalled` — sait faire sur une base réduite comme sur une base à jour.

### 9.9 Ce que le seed démontre, par le VRAI mécanisme

Le §5 a mesuré qu'une seule card du seed est figée : `5eed…00c3`. La tranche 2 ne change **ni
cette card, ni son antidatage** — le §7.3 réserve l'extension du jeu à la tranche 3, qui en a
besoin pour démontrer un classement.

Elle ajoute une seule chose : **le seed appelle `app.relancer_cards_figees()`**, après l'antidatage
qui rend la card figée. Le `stalled` du jeu de développement est donc écrit par **la fonction du
produit**, celle que le job appelle, et non fabriqué par un `insert` de fixture — l'exigence de
`CLAUDE.md` §8, qui interdit de « fabriquer artificiellement des traces censées représenter
l'exécution d'un processus réel ».

L'appel est **convergent** : rejoué, il n'écrit rien de plus, par le prédicat du §9.4.

**Pourquoi le seed appelle plutôt que d'attendre le job.** Le job s'amorce à dix secondes après
l'application des migrations, donc **avant** que le seed n'ait créé ses cards : son premier passage
ne trouve rien, et le suivant n'aura lieu que le lendemain. Sans cet appel, un développeur qui
monte la pile ne verrait aucune relance de la journée — un écran vide que `CLAUDE.md` §8 proscrit.

### 9.10 Les preuves exigées de la tranche 2

| Niveau | Preuves attendues |
|---|---|
| pgTAP | Le vocabulaire compte quinze valeurs et accepte `stalled` ; forme de la fonction — `volatile`, `security definer`, `search_path` vide, propriétaire `postgres` ; ACL : aucun des quatre rôles clients n'a `execute` ; le job existe, unique, avec son nom, sa commande, sa base, son rôle, son activation et sa cadence **nominale** après promotion ; une ligne `succeeded` dans `cron.job_run_details` ; **l'inscription** — une card figée reçoit exactement un `stalled`, `actor_id` nul, `payload` aux deux clés attendues ; **l'idempotence** — le second appel rend `0` et n'ajoute aucune ligne ; **le réarmement** — après déplacement de l'étape, un nouvel appel inscrit de nouveau ; **les exclusions héritées** — une card archivée, en corbeille ou endormie ne reçoit rien, puisque la fonction du §3 ne la rend pas |
| API | Le `stalled` du seed est **lisible dans la timeline** par les profils autorisés et **absent** pour la lectrice, dont le track est fermé : la relance n'ouvre aucune porte. Aucune route neuve n'est ajoutée — la fonction est privée, et une preuve doit constater qu'elle **n'est pas** appelable par `rpc/` |
| Unitaire (webapp) | **Aucun** : la tranche 2 ne touche aucun module de la webapp |
| E2E d'interface | **Aucun** : la tranche 2 ne livre aucun écran. L'absence est nommée, non compensée |
| Visuel | **Aucun**, pour la même raison |
| Harnais | `scripts/verify-relances.sh` étendu, non complaisant : la dégradation de l'idempotence, celle de la fermeture des privilèges et celle de la cadence du job doivent chacune faire rougir la suite, et la restauration est **constatée**. **Section 7 ter, ajoutée le 2026-08-25 (INC-210)** : la contrainte est réduite aux neuf valeurs d'avant la migration `0020`, le répertoire ENTIER est rejoué, et le harnais exige que le conteneur sorte en `0` et que le vocabulaire revienne **entier et `VALID`**. Le verdict est lu sur l'état du conteneur, `docker compose up` rendant `0` même quand le runner sort en `3` — mesuré. Un témoin refuse de déclarer le contrôle vert sur une base sans ligne `stalled`, cas où le rejeu réussirait sans rien prouver |
| Seed | `scripts/verify-seed-demo.sh` ou le harnais dédié constate qu'après application du seed la card `5eed…00c3` porte exactement **un** `stalled`, écrit par la fonction et non par une fixture |

### 9.11 Retour arrière

Le retour arrière de la migration `0054` désordonnance `p2enjoy-relances-cards-figees`, supprime
`app.relancer_cards_figees()`, puis **laisse les événements `stalled` déjà écrits** : ce sont des
faits d'histoire, et `card_events` est immuable par construction. Le `CHECK` conserve donc ses
quinze valeurs ; le rétrécir invaliderait des lignes existantes. `pg_cron` n'est pas désinstallé,
d'autres jobs y vivent (`docs/SPEC-scheduler.md` §7).

---

## 10. Tranche 3 — la surface, contrat exécutable

Chapitre écrit le **2026-08-24**, après mesure sur la pile de développement debout et seedée, et
**avant** la première ligne de la tranche 3. Chaque valeur citée ici a été relevée sur cette pile ;
aucune ne vient d'un souvenir.

Le §7.3 esquissait cette tranche en une phrase ; il ne la contractait pas. Ce chapitre la contracte,
et il commence par nommer un fait que le §7.3 ne voyait pas : **la relance de la tranche 2 est
écrite en base et n'est lisible nulle part**. C'est mesuré au §10.3, et cela change le découpage.

### 10.1 Trois sous-tranches, et l'ordre est celui de la dépendance

| Sous-tranche | Objet | Pourquoi à cette place |
|---|---|---|
| **3a** | Le jeu de démonstration : **quatre** affaires figées au lieu d'une | Le §5 nomme cette dette depuis la tranche 1. Une seule ligne ne démontre ni classement, ni regroupement : les preuves de 3b et 3c seraient à réécrire derrière elle |
| **3b** | La relance **nommée dans le fil** d'une affaire | La tranche 2 écrit un `stalled` que le fil rend « Événement » (§10.3, mesuré). Le §9.1 promet « un fait que l'utilisateur rencontre en ouvrant la timeline » : la promesse n'est pas tenue |
| **3c** | L'**écran** qui liste les affaires figées de l'appelant, son entrée de navigation, son chapitre de manuel et ses captures | C'est la surface que le §7.3 nomme. Elle lit ce que 3a peuple et renvoie vers le fil que 3b rend lisible |

**Hors périmètre, et l'unité qui le porte** : tout email (`CRM-063`), toute notification
(`CRM-064`), tout score de santé (`CRM-066`), tout digest (`CRM-069`) — la frontière du §1, tenue
sans changement. **Aucune écriture** n'est livrée par cette tranche : ni report, ni « traité », ni
mise en sommeil depuis l'écran. Le seul chemin d'écriture reste la fiche de l'affaire, et un second
geste ici en ferait une seconde définition du même geste (`docs/DESIGN_SYSTEM.md` §5.36, règle
reprise telle quelle).

### 10.2 Sous-tranche 3a — le jeu de démonstration, et ce que sa révision coûte

#### 10.2.1 Les quatre affaires retenues, MESURÉES et non prédites

Le §9.12 de `docs/SPEC-seed.md` pose **exactement une** affaire au-delà de son seuil. Le §5 du
présent document annonce depuis la tranche 1 que cela ne suffira pas. Le vieillissement proposé a
été **appliqué dans une transaction annulée** le 2026-08-24, et `public.cards_figees()` rend, sous
`postgres` :

| Affaire | Channel / Track | Seuil | Âge posé | `retard_jours` |
|---|---|---|---|---|
| `…0c4` « Refonte intranet Ville de Lyon » | `refonte` / `studio-web` | 5 | 40 j | **35** |
| `…d007` « Contrat TMA 2026 — Mairie de Vaulx » | `maintenance` / `studio-web` | 7 | 25 j | **18** |
| `…0c3` « Audit sécurité applicative » *(inchangée)* | `grands-comptes` / `conseil-ia` | 14 | 30 j | **16** |
| `…0cf` « Reprise du dossier Marchand » | `dossiers-2023` / `legacy-2023` | 5 | 12 j | **7** |

**Quatre affaires, quatre channels, trois tracks, et quatre retards deux à deux distincts.** Chacun
de ces quatre nombres porte une exigence, et aucun n'est décoratif :

1. **Les retards sont distincts**, donc l'ordre `retard_jours desc` du §3.4 est **total** sur ce
   jeu : deux applications successives rendent la même suite, et une preuve peut asserter la suite
   entière plutôt qu'un ensemble. Le départage par `title` reste écrit dans la fonction, il n'est
   simplement pas exercé par ce jeu — et c'est préférable : une preuve qui dépendrait d'une égalité
   de retard casserait au premier changement de seuil ;
2. **quatre channels distincts**, donc le regroupement du §10.7 a quatre groupes d'une ligne, et
   `studio-web` en porte **deux** — le seul cas où le regroupement par track a plus d'un membre, et
   donc le seul qui prouve qu'il regroupe ;
3. **les seuils diffèrent** — 5, 7, 14 — donc la ligne rend une donnée qui varie, et une preuve ne
   peut pas confondre `seuil_jours` avec une constante ;
4. **`…0c3` ne bouge pas.** Elle reste à trente jours pour un seuil de quatorze : tout ce que
   `docs/SPEC-seed.md` §9.12 écrit d'elle, et tout ce que `e2e/ui/anciennete-board.spec.ts` mesure
   sur le board de `grands-comptes`, reste vrai **au caractère près**. La révision **ajoute**, elle
   ne déplace pas.

**Pourquoi ces quatre-là, et pas quatre autres.** Le critère est la **lisibilité par les trois
profils**, mesurée le 2026-08-24 avec les jetons réels :

| Profil | Affaires figées lues |
|---|---|
| `admin` | **4** |
| `business_developer` | **4** |
| `viewer` | **3** — toutes sauf `…0c3`, dont le track `conseil-ia` lui est fermé (`CRM-012`) |

C'est un **gain de valeur probante**, et c'est la raison principale du choix. Aujourd'hui la
lectrice obtient un écran **vide**, indistinguable d'un écran sans donnée ; demain elle obtient
**trois lignes sur quatre**, et le refus de la quatrième se mesure comme une ligne manquante dans
une liste peuplée — la forme la plus stricte du « zéro ligne, jamais une erreur » du §3.2.

**Le vieillissement passe par la clé de service**, après la remise à zéro générale et dans la même
section que `…0c3`, exactement comme le §9.12.3 de `docs/SPEC-seed.md` le pose : `entered_step_at`
n'est ouverte à aucun rôle client, et le recul part de `now()` — un rejeu ne cumule rien.

#### 10.2.2 Ce que la révision coûte, nommé fichier par fichier

Le contrat « exactement une » est **écrit à six endroits**, et chacun est **révisé, jamais retiré**
(`CLAUDE.md` §18, `docs/CloudWorker.md` §3.1). L'inventaire a été fait par lecture, et il est
exhaustif à la date d'écriture :

| Porteur | Ce qu'il assère aujourd'hui | Révision |
|---|---|---|
| `docs/SPEC-seed.md` §9.12.6 ligne *a* | « Exactement **une** card active » | **quatre**, énumérées avec leur retard, et l'ordre attendu |
| `scripts/verify-board.sh` | `au_dela -eq 1` | `-eq 4`, plus l'assertion que `…0c3` en fait partie et que son âge est inchangé |
| `e2e/api/board.spec.ts` | « une card du seed, et une seule, dépasse son seuil » | quatre, mesurées par la vraie API avec le jeton réel |
| `e2e/api/relances.spec.ts` lignes *a*, *d*, *e* | `toHaveLength(1)` ; `viewer` ⇒ `[]` | quatre pour l'`admin` et le `business_developer`, **trois** pour la lectrice — un refus qui se lit dans une liste peuplée |
| `supabase/tests/0051_cards_figees.test.sql` et `0052_relances_automatiques.test.sql` | conformité du seed : une ligne, et c'est `…0c3` | quatre lignes, `…0c3` comprise, et l'ordre |
| `supabase/seed/apply-seed.sh` | gardes `au_dela = 1`, `relances = 1`, `autres = 0` | `au_dela = 4`, `relances = 4`, et la garde « aucun `stalled` hors des quatre » |

**Le §7.4 de `docs/SPEC-workflow-engine.md` n'est PAS touché** : il a déjà été révisé par le §9.12
et porte la présence d'une bascule, non un compte. Vérifié par lecture, et écrit ici pour que la
prochaine session ne le rouvre pas pour rien.

**Une garde de non-complaisance est due, et elle change de forme.** Le §9.12.4 exigeait qu'« reculer
la date d'une **seconde** card fasse échouer le harnais ». Avec quatre affaires voulues, la garde
devient : reculer la date d'une **cinquième** doit faire échouer, et **rajeunir l'une des quatre**
aussi. Deux dégradations, deux sens — sans la seconde, un seed qui cesserait de vieillir `…0cf`
passerait inaperçu.

#### 10.2.3 Ce que le seed écrit, et par quel mécanisme

Rien de neuf : `apply-seed.sh` appelle déjà `app.relancer_cards_figees()` après l'antidatage
(§9.9). Les quatre affaires reçoivent donc leur `stalled` **par la fonction du produit**, jamais par
une fixture — `CLAUDE.md` §8, tenu sans changement. L'appel reste **convergent** par le prédicat du
§9.4.

**MESURÉ le 2026-08-24**, sur le seed courant, le `payload` réellement écrit :

```
type    = stalled
payload = {"seuil_jours": 14, "retard_jours": 16}
actor_id = NULL
```

Les deux clés du §9.6 et la nullité **obtenue** du §9.5 sont donc constatées sur la donnée, et non
supposées. Les trois affaires ajoutées porteront leurs propres nombres — 5/35, 7/18, 5/7 —, ce qui
donne au §10.3 quatre détails différents à rendre plutôt qu'un seul répété.

### 10.3 Sous-tranche 3b — la relance est écrite et ILLISIBLE, et c'est mesuré

**Le fait, relevé le 2026-08-24 par lecture du produit** — `webapp/src/lib/timeline.ts` et
`webapp/src/i18n/fr.ts` :

- `TYPES_EVENEMENT` compte **treize** valeurs, et `stalled` n'en fait pas partie ;
- `FAMILLE_PAR_TYPE` ne le range nulle part, donc `familleDe('stalled')` tombe sur son **repli**
  documenté et rend `cycle` ;
- aucune clé `timeline.event.stalled` n'existe, donc le fil rend `timeline.event.unknown`, dont le
  texte est le mot **« Événement »**.

Le repli fait exactement ce pour quoi il a été écrit — « un événement inconnu doit rester
**visible** : c'est une mémoire » — et c'est ce qui a évité un `undefined` à l'écran. Mais le §9.1
de ce document promet que la relance est « un fait inscrit dans le produit, que l'utilisateur
rencontre **en ouvrant la timeline de son affaire** » : une ligne intitulée « Événement » ne tient
pas cette promesse. La tranche 2 a livré la moitié de sa propre spécification, et **c'est cette
tranche qui livre l'autre**.

#### 10.3.1 Le contrat

| Point | Valeur | Motif |
|---|---|---|
| `TYPES_EVENEMENT` | **quatorze** valeurs, `stalled` comprise | Le type est écrit par le produit depuis la migration `0054` : il est nommé, et non plus toléré par un repli |
| Famille | **`cycle`** | « Qu'est devenue cette affaire ? » — elle a **stagné**. C'est le même repli qu'aujourd'hui, désormais **écrit** : une valeur obtenue par défaut et une valeur choisie ne se distinguent pas à l'œil, et seule la seconde résiste à un changement du repli |
| Libellé | **« Relance automatique »** | Il nomme le **fait**, pas la mécanique : « Affaire figée » décrirait un état, or la ligne du fil date un geste. Le vocabulaire est celui du produit, jamais `stalled` |
| Icône | **`AlarmClock`** (Lucide) | Aucun autre type du §5.11 ne la porte ; `Sparkles`, `Archive`, `Moon` et `Sun` sont pris, et le §9 du design system interdit qu'une icône serve deux objets distincts |
| Pastille | `--color-danger-soft`, icône `--color-danger` | C'est le **seul** type du fil que la teinte de danger qualifie, et elle est déjà celle de l'ancienneté dépassée (§5.1, §5.36) : le même signal doit avoir la même forme |
| Détail | **« {retard} jours de retard, pour un seuil de {seuil} jours »** | Les deux clés du `payload` (§9.6), et **rien d'autre** — aucun libellé d'étape, que le §9.6 refuse de recopier |

**Le détail est composé par une CLÉ DE TRADUCTION, jamais par concaténation** (§10 du design
system). L'accord se pose : « 1 jour de retard » et « 16 jours de retard » ne prennent pas la même
forme, et un retard de **zéro** est légitime — la borne du §2.5 est large, donc une affaire atteinte
exactement sur son seuil porte `retard_jours = 0` et se lit « atteint son seuil de 14 jours », phrase
distincte plutôt que « 0 jours de retard ».

**Un `payload` amputé ne rend AUCUN détail, et surtout pas un `undefined`** : la ligne retombe alors
sur son seul libellé, comme le §5.11 l'exige déjà d'un libellé d'étape non résolu. La valeur vient
du backend, et un type ne garantit jamais une valeur (`docs/SPEC-types.md`).

**Aucune sixième bascule de filtre.** Le §5.11 du design system pose cinq familles et écrit pourquoi
— « une sixième bascule pour deux types contredirait le §5.11 » a déjà été tranché par `CRM-081`. Un
type de plus dans `cycle` ne rouvre pas cet arbitrage.

### 10.4 Sous-tranche 3c — l'adresse de l'écran, et sa place dans la navigation

**Adresse : `/affaires-figees`.** Une route de **premier niveau**, portée par une entrée de la barre
latérale, et non une section de `/reglages`. C'est le raisonnement qui a déjà placé le carnet
(`CHEMIN_CONTACTS`), les objectifs, les coûts et « Ma journée » hors des réglages : **une liste
d'affaires en retard n'administre rien, elle porte le travail**.

Elle figure dans `ROUTES` — son titre est une clé de traduction et son contenu ne dépend d'aucun
paramètre d'adresse —, et la couverture exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` que
`routes.test.tsx` tient reste donc vraie, avec une entrée de plus **des deux côtés**.

**Place dans la barre latérale : immédiatement après « Ma journée », avant « Réglages ».** Les deux
écrans répondent à la même question — « qu'est-ce qui me réclame ? » — et se lisent dans cet ordre :
ce qui est **dû** aujourd'hui, puis ce qui **dort** depuis trop longtemps. Les placer côte à côte
n'est pas une commodité : le §2.6 pose qu'une échéance dépassée et une affaire figée sont deux
notions **différentes** qui se recoupent souvent, et le seul endroit où cette différence
s'enseigne est la navigation, où l'on voit les deux entrées voisines.

**Icône : `Hourglass`** (Lucide). Aucune entrée transverse ne la porte — `LayoutGrid`, `Inbox`,
`Contact`, `Goal`, `ChartColumn`, `CalendarCheck` et `Settings` sont prises —, et elle dit le temps
qui s'écoule sans que rien n'avance, ce qu'est exactement une affaire figée. Elle est **distincte
d'`AlarmClock`** du §10.3.1, et la distinction est voulue : l'écran montre un **état**, la ligne du
fil date un **geste**.

**Chargée à la demande** (`lazy`), comme le carnet, l'inbox, les objectifs et « Ma journée » : un
écran que la plupart des sessions n'ouvrent pas n'a pas à peser sur le premier rendu de toutes les
autres (`CLAUDE.md` §21).

### 10.5 Ce que l'écran lit, et pourquoi en DEUX requêtes — MESURÉ

L'écran fait **deux lectures successives**, et ce n'est pas un défaut de conception : c'est ce que
la pile permet, mesuré.

**Lecture 1 — la règle.** `POST /rest/v1/rpc/cards_figees`, sans argument. Elle rend les dix
colonnes du §3.1, dont `retard_jours` et `seuil_jours`, que rien d'autre ne sait calculer.

**Lecture 2 — les libellés.** `GET /rest/v1/cards?id=in.(…)` avec ses relations embarquées, sur les
**seuls identifiants que la lecture 1 a rendus**.

**POURQUOI PAS UNE SEULE, ET C'EST MESURÉ LE 2026-08-24.** `public.cards_figees()` rend un
`TABLE(...)`, c'est-à-dire un type composite anonyme, et non un `SETOF public.cards`. PostgREST ne
lui connaît donc aucune clé étrangère :

```
POST /rest/v1/rpc/cards_figees?select=card_id,title,channels(slug)
=> PGRST200
   "Searched for a foreign key relationship between 'record' and 'channels'
    in the schema 'public', but no matches were found."
```

Le §3.1 refuse par ailleurs de recopier un libellé d'étape dans la fonction — « une fonction qui
recopierait le libellé dirait demain ce qui était vrai aujourd'hui » —, et cette règle n'est pas
rouverte pour économiser un aller-retour. La seconde lecture est donc **la conséquence assumée** de
deux décisions déjà prises, et elle est bornée : elle porte sur les identifiants **déjà filtrés**
par la règle, jamais sur le pipeline entier. C'est précisément ce que le §2.1 exigeait — ne pas
« télécharger toutes les cards pour en écarter la quasi-totalité ».

**La chaîne `select` de la lecture 2, MESURÉE sur la pile** — les deux désambiguïsations sont
obligatoires et ont été trouvées par l'erreur, pas par la lecture :

```
id, title,
channels!cards_channel_id_workspace_id_fkey(slug, name, tracks(slug, name)),
workflow_steps!cards_current_step_id_workflow_id_fkey(id, label_override,
                                                      workflow_nodes_catalog(label))
```

- **`channels` doit être désambiguïsé** : `cards` porte **deux** clés étrangères vers `channels` —
  `cards_channel_id_workflow_id_fkey` et `cards_channel_id_workspace_id_fkey` —, et un `channels(…)`
  nu rend `PGRST201`. La seconde est retenue, comme `colonnes-ma-journee.ts` et `card-costs.ts` le
  font déjà : une seule forme dans tout le produit ;
- **`workflow_steps` porte `label_override`, jamais `label`** : un `workflow_steps(label)` rend
  `42703 — column workflow_steps_1.label does not exist`. Le libellé d'une étape est
  `coalesce(label_override, workflow_nodes_catalog.label)`, exactement la résolution de
  `resoudreEtape` dans `board.ts`, et l'écran la **réemploie** au lieu d'en écrire une seconde.

**Réponse mesurée**, pour `…0c3` :

```json
{"id":"…0c3","title":"Audit sécurité applicative",
 "channels":{"slug":"grands-comptes","name":"Grands comptes",
             "tracks":{"slug":"conseil-ia","name":"Conseil & IA"}},
 "workflow_steps":{"id":"…0061","label_override":null,
                   "workflow_nodes_catalog":{"label":"Prospection"}}}
```

**Une affaire rendue par la lecture 1 mais absente de la lecture 2 reste LISTÉE**, avec son retard,
son seuil et son titre — que la lecture 1 rend déjà —, mais **sans lien, sans pilule et sans nom
d'étape**. C'est la règle du §5.32 du design system : un lien vers une adresse incomplète mènerait à
un écran que l'utilisateur croirait cassé. Le cas n'est pas théorique — les deux lectures ne sont
pas atomiques, et une affaire mise à la corbeille entre elles disparaîtrait de la seconde.

**Aucune troisième lecture, et aucun `count=exact`** : il n'y a pas de pagination, donc pas de
nombre de pages à calculer, et le compte de chaque groupe est celui des lignes **rendues**. C'est le
§17.4 de `docs/SPEC-cards.md`, tenu sans changement.

### 10.6 La portée, et pourquoi il n'y en a qu'une

**L'écran n'offre AUCUNE bascule de portée**, contrairement à « Ma journée » (§5.36). Ce n'est pas
un oubli, et le motif est dans la fonction : `public.cards_figees()` est `security invoker` (§3.2) et
ne prend **aucun argument**. Elle rend donc « ce que l'appelant peut lire », sans autre dimension —
il n'existe aucun `owner_id = moi` à filtrer côté serveur, et le poser côté client ferait de l'écran
le juge d'un rangement que la base ne connaît pas.

Ajouter un argument à la fonction est une **modification de la tranche 1**, dont le contrat d'API
est écrit, mesuré et prouvé au §4. Elle n'est pas faite ici, et l'écart est **nommé** plutôt que
comblé au passage : si le besoin « seulement mes affaires » se manifeste, il se traitera par une
révision explicite du §3.1 et de son contrat, jamais par un filtre d'écran.

### 10.7 Le regroupement et le classement

**Les affaires sont regroupées par CHANNEL, et les groupes sont ordonnés par le retard de leur
première ligne.**

- **Par channel, et non par track** : le channel est le dossier où l'affaire vit, c'est lui que la
  pilule « Track › Channel » du §5.29 nomme, et c'est le grain auquel on va agir. Un regroupement
  par track mettrait `refonte` et `maintenance` dans le même bloc alors que ce sont deux dossiers
  distincts — mesuré sur le jeu de 3a, où `studio-web` porte les deux ;
- **l'ordre à l'intérieur d'un groupe est celui du serveur**, conservé tel quel : `retard_jours desc,
  title asc` (§3.4). Le rejouer à l'écran le ferait diverger le jour où la fonction changera —
  c'est la règle que `decouperEnSections` tient déjà pour « Ma journée » ;
- **l'ordre DES GROUPES est celui de leur première ligne**, donc du plus gros retard du groupe. Un
  ordre alphabétique de channel ferait descendre en bas d'écran le dossier le plus en retard, ce qui
  est exactement l'information que l'écran existe pour donner.

**Le regroupement se fait à la COMPOSITION, jamais au serveur** : la fonction rend une suite
ordonnée, et découper cette suite en groupes est une opération de rendu qui ne demande aucune
seconde requête. C'est le raisonnement du §17.5 de `docs/SPEC-cards.md`, réemployé.

**Un groupe porte son compte, en toutes lettres et dans son propre élément** — « Grands comptes (1) »
—, jamais un badge nu : un chiffre ne dit pas ce qu'il compte, et un nœud de texte accolé au libellé
devient un élément flex anonyme que `gap` ne sépare pas (défaut « Discussion1 », §5.11).

**Un groupe vide n'existe pas** : un groupe naît d'au moins une ligne. Il n'y a donc rien à écrire
sur l'absence, contrairement aux sections fixes de « Ma journée ».

### 10.8 Ce que chaque ligne rend, et dans quel ordre

| Rang | Élément | Forme |
|---|---|---|
| 1 | **Le retard** — « 35 j » | Donnée technique (§2) : monospace, chiffres tabulaires, pastille `--color-danger-soft` / `--color-danger-on-soft`. **En tête de ligne**, comme l'échéance du §5.36 : c'est lui qui range cet écran |
| 2 | **Le titre de l'affaire** | Lien vers sa fiche. Le titre **est** le libellé du lien, sans `aria-label` qui le remplacerait |
| 3 | **L'étape** — « Prospection » | Pilule neutre `--color-hover` / `--color-text-2`, `rounded-full` (§5.6). C'est le dossier interne de l'affaire, pas son identité |
| 4 | **Le seuil** — « seuil 14 j » | 13 px `--color-text-2`. Sans lui, « 35 j de retard » ne se lit pas : un retard sans son seuil n'a pas d'échelle (§9.6, même raison) |
| 5 | **La pilule « Track › Channel »** | Celle du §5.29, réemployée **sans copie** et **entière**, destination comprise. Elle ferme la ligne : elle situe l'affaire, elle ne la nomme pas |

**La teinte de danger porte sur le RETARD, jamais sur la ligne** — la règle du §5.36, tenue au
caractère près : une affaire figée est un travail à faire, pas une erreur. Le §1 est tenu par le
titre de l'écran et par l'unité « j », écrits en toutes lettres.

**Le retard s'écrit en jours, avec son unité, dans son PROPRE élément** — « 35 » puis « j », jamais
un nœud de texte accolé au nombre (§5.18, §5.11). Un retard de **zéro** est légitime (borne large du
§2.5) et se rend « 0 j » : c'est une donnée, pas une absence, et la cellule vide du §5.9 ne
s'applique pas.

**Sous le palier `md`, la ligne se replie et gagne de la hauteur** — l'écart que le §5.21 assume pour
sa liste plate, pris ici pour la même raison : cinq éléments ne tiennent pas sur 390 px, et la
réponse d'une liste plate au manque de place est de se replier, non de tronquer une donnée. `md` et
jamais `sm`, qui est un variant inconnu que Tailwind supprime en silence (§11, §5.20). La page ne
défile jamais horizontalement (§7).

### 10.9 Les états

Les quatre états du §5.8 sont traités, plus l'absence d'espace de travail — le patron de
`MaJournee`, tenu sans écart :

| État | Rendu |
|---|---|
| Chargement | Squelette de liste, jamais un spinner plein écran |
| Erreur | Message compréhensible et **action de reprise qui relit réellement** |
| Aucun espace de travail | Le client n'existe pas : état vide nommé, sans action |
| **Vide** | « Aucune affaire figée », et **AUCUNE action** |

**L'état vide n'offre aucune action, et c'est l'écart assumé au §5.8** — le même que la corbeille
(§5.16) et le carnet (§5.19) prennent : il n'y a rien à faire d'une liste d'affaires en retard qui
est vide, et un bouton y serait un chemin vers nulle part. **Le message dit que l'état est sain, pas
qu'il manque quelque chose** : « aucune affaire ne dort dans son étape » est une bonne nouvelle.

**Un seul vide, et non deux.** « Ma journée » en porte deux parce qu'elle a une portée à élargir
(§5.36) ; ici il n'y en a pas (§10.6), donc rien ne distingue « rien pour moi » de « rien pour
personne ». En écrire deux inventerait une distinction que la donnée ne porte pas.

**Le vide de la lectrice est le vide ordinaire, jamais un refus mis en scène.** La RLS rend `200` et
zéro ligne ; l'écran ne calcule aucun droit et ne nomme jamais ce qu'il ne montre pas
(`docs/SPEC-permissions-rls.md` §7, §5.33 du design system). Sur le jeu de 3a, elle en voit **trois**
et l'écran n'écrit nulle part qu'une quatrième existe.

### 10.10 Accessibilité et clavier

- La liste est une `section` par groupe, chacune portant son `h2` et sa `ul` — le patron du §5.36 ;
- **le compte de lignes est ANNONCÉ** dans une région `aria-live` polie : une liste qui se recompose
  sans un mot est un changement invisible pour qui ne voit pas l'écran (§8) ;
- **le nom accessible de la pilule de channel nomme sa destination** — « Ouvrir Conseil & IA ›
  Grands comptes » —, la règle du §5.29 : la même pilule répétée sur quatre lignes ne dirait pas ce
  que chacune ouvre ;
- **aucune cible sous 40 px**, et le retard n'est pas une cible : c'est une donnée ;
- **la console du navigateur reste vierge** de toute erreur et de tout avertissement
  (`docs/CloudWorker.md` §3).

### 10.11 Contrat d'API de la tranche 3

Aucune route neuve. Le contrat porte sur ce que les **deux lectures** de l'écran rendent aux jetons
réels des trois profils, sur le jeu de 3a :

| # | Appelant | Appel | Attendu |
|---|---|---|---|
| a | `admin` | `rpc/cards_figees` | `200`, **4** lignes, dans l'ordre `…0c4`, `…d007`, `…0c3`, `…0cf` |
| b | `admin` | ligne *a* | les retards valent **35, 18, 16, 7**, strictement décroissants |
| c | `business_developer` | `rpc/cards_figees` | `200`, **4** lignes, la même suite |
| d | `viewer` | `rpc/cards_figees` | `200`, **3** lignes — `…0c3` **absente**, et **aucune erreur** |
| e | anonyme | `rpc/cards_figees` | `401` / `42501` — inchangé (§4 ligne *f*) |
| f | `admin` | la lecture 2 sur les quatre identifiants | `200`, 4 lignes, chacune portant son channel, son track et le libellé de son étape |
| g | `viewer` | la lecture 2 sur les **quatre** identifiants | `200`, **3** lignes : la seconde lecture applique la même RLS que la première, et l'écran ne peut donc pas rendre par la bande ce que la règle refuse |
| h | `admin` | `card_events?type=eq.stalled` | `200`, **4** événements, un par affaire figée, `actor_id` nul et `payload` aux deux clés |

La ligne *g* est la plus importante des huit : elle mesure que **la seconde lecture ne rouvre
aucune porte**. Un écran qui obtiendrait les libellés d'une affaire dont la règle lui refuse la
ligne divulguerait par la bande — et rien dans la lecture 1 ne l'en empêcherait.

### 10.12 Preuves exigées

| Niveau | Preuves attendues |
|---|---|
| pgTAP | Conformité du seed révisée : **quatre** affaires figées, leur ordre, `…0c3` comprise et inchangée ; **quatre** `stalled`, un par affaire, acteur nul et `payload` aux deux clés |
| API | Les huit lignes du §10.11, avec les jetons réels des trois profils. Les scénarios *a*, *d* et *e* de `e2e/api/relances.spec.ts` sont **révisés**, jamais retirés, motif écrit dans le fichier |
| Unitaire (webapp) | Le module de composition : le regroupement par channel, l'ordre des groupes, la conservation de l'ordre serveur **dans** un groupe, la ligne rendue sans sa lecture 2, le retard nul, la famille et le libellé de `stalled` |
| E2E d'interface | Le parcours réel, **au clavier et à la souris**, depuis la barre latérale : les quatre lignes de l'`admin`, les **trois** de la lectrice, l'ordre, le lien vers une fiche, la pilule qui ouvre son channel, l'état vide, et la ligne « Relance automatique » **dans le fil** d'une affaire figée |
| Visuel | Captures aux **quatre** paliers du §7 — 1440, 1152, 900 et 390 px —, produites depuis l'application réellement exécutée et **observées** (`CLAUDE.md` §16). Plus une capture du fil portant la relance nommée |
| Harnais | `scripts/verify-relances.sh` étendu, non complaisant : la dégradation du regroupement, celle de l'ordre des groupes et celle du libellé de `stalled` doivent chacune faire rougir, et la restauration est **constatée** |
| Seed | `scripts/verify-board.sh` révisé : **quatre** affaires au-delà de leur seuil, et au moins une en deçà. Les deux dégradations du §10.2.2 mordent |

### 10.13 Le manuel — « chapitre 30 » n'existe pas, et voici ce qu'il devient

L'en-tête de ce document et le §7.3 renvoient au « chapitre 30 » de `docs/manual.md`. **Ce chapitre
n'existe pas, et il ne peut pas exister** : le manuel numérote ses chapitres de 1 à 6 avec des
suffixes latins — `1 bis`, `3 ter`, `3 quater`, `5 septies` —, et n'a jamais compté jusqu'à trente.
La référence était un repère d'intention, pas une adresse.

**Le chapitre de cette tranche est `3 quinquies` — « Les affaires figées : ce qui dort depuis trop
longtemps »**, immédiatement après `3 quater` « Ma journée ». La place suit exactement celle de
l'entrée de navigation (§10.4), et pour son motif : les deux écrans répondent à la même question et
s'enseignent l'un après l'autre.

Il couvre : ce qu'être figée veut dire et d'où vient le seuil, ce que l'écran montre et ce qu'il ne
montre pas, pourquoi deux personnes n'y lisent pas la même chose, la relance inscrite dans le fil, et
ce que le produit ne fait **pas** — aucun email, aucune notification (§1).

La référence « chapitre 30 » est **corrigée** dans l'en-tête de ce document et au §7.3 par le même
changement, et l'écart est consigné à `docs/INCONSISTENCY_REPORT.md` : une référence documentaire
fausse pendant deux tranches est un fait à enregistrer, pas à effacer en silence.

## 11. Points ouverts de la tranche 3

Aucun arbitrage n'est demandé. Deux écarts sont **nommés** plutôt que comblés au passage, et chacun
porte la condition de sa reprise :

1. **Aucune portée « mes affaires »** (§10.6) — elle demanderait un argument à
   `public.cards_figees()`, donc une révision du contrat de la tranche 1 ;
2. **Aucune pagination, aucun tri commandé** — l'ordre vient du serveur, et poser une pagination sur
   une lecture dont personne n'a mesuré le volume serait de l'optimisation sans mesure
   (`CLAUDE.md` §21). C'est l'écart que le §10.7 de `docs/SPEC-contacts.md` prend déjà pour le
   carnet, avec la même condition de reprise : une mesure.
