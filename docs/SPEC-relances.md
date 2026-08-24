# Spécification — cards figées et relances automatiques

Contrat exécutable de `CRM-062` (`docs/BACKLOG.md`, chunk 5).

- Unité de backlog : `CRM-062`.
- Modèle : `docs/SCHEMA.md` §5 (`cards`), §4 (`workflow_nodes_catalog`, `workflow_steps`).
- Règles d'autorisation : `docs/SPEC-permissions-rls.md` §3.7 (`app.can_read_card`).
- Ordonnancement : `docs/SPEC-scheduler.md` (`CRM-017`).
- Interface existante qui porte déjà la notion : `docs/SPEC-workflow-engine.md` §7.4 (pastille
  d'ancienneté du board), `docs/DESIGN_SYSTEM.md` §5.1.
- Manuel : `docs/manual.md` chapitre 30.
- État : **tranche 1 en cours**, rédigée après mesure sur la pile de développement le
  2026-08-24, seed appliqué. Les tranches 2 et 3 sont spécifiées au §7 et **non livrées**.

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

`execute` est révoqué de `public`, puis accordé à `authenticated` et `service_role` — exactement
l'ACL mesurée de `public.etat_messagerie` et de `public.previsualiser_exigence`.

`anon` n'a **aucun** privilège d'exécution : un appelant anonyme est refusé par le **privilège**,
avant toute politique, et PostgREST rend `401` / `42501`. C'est plus strict qu'une politique qui
rendrait un tableau vide, et c'est ce que les deux fonctions jumelles font déjà.

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
| f | anonyme | `rpc/cards_figees` | `401`, `42501` — refusé par le privilège |
| g | `admin` | `GET` sur la même route | `404` : la fonction est `stable`, PostgREST l'expose aussi en `GET` — **à mesurer**, la ligne est une prédiction |
| h | `admin` | `rpc/cards_figees?select=card_id,retard_jours` | `200` : la projection s'applique à une fonction rendant `setof record` — **à mesurer**, prédiction |
| i | `admin` | `rpc/cards_figees?retard_jours=gt.20` | `200`, `[]` : le filtre s'applique après la fonction — **à mesurer**, prédiction |
| j | `viewer` | la card `…00c3` par `GET /cards?id=eq.…` | `200`, `[]` — contre-épreuve de la ligne *e* : c'est bien la RLS, et non la fonction, qui refuse |

Les lignes *g*, *h* et *i* sont **signalées comme des prédictions** et seront corrigées par la
mesure plutôt que le test relâché, selon le précédent de `CRM-013`.

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

Trois propriétés à spécifier avant d'écrire cette tranche, et qui ne le sont pas encore :

1. **l'idempotence** : une card figée depuis six semaines ne doit pas recevoir quarante-deux
   événements. L'ancrage naturel est `entered_step_at` — un événement par *entrée dans l'étape* —,
   ce qui rearme automatiquement la relance après tout `move_card` ;
2. **l'acteur** : `actor_id` est nul, comme pour la clé de service (§14.5). Une relance n'a pas
   d'auteur humain ;
3. **le `payload`** : le seuil et le retard au moment de l'inscription, sans aucun libellé (§14.6).

### 7.3 Tranche 3 — la surface

L'écran qui liste les affaires figées de l'appelant, son entrée de navigation, le chapitre 30 du
manuel, les captures aux quatre paliers, et **l'extension du seed** que le §5 a nommée : une seule
card figée ne démontre ni classement, ni regroupement.

## 8. Points ouverts

Aucun arbitrage n'est demandé par la tranche 1. Les trois propriétés du §7.2 seront spécifiées
avant la tranche 2, et non pendant.
