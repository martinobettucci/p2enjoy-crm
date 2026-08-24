# Spécification — cards figées et relances automatiques

Contrat exécutable de `CRM-062` (`docs/BACKLOG.md`, chunk 5).

- Unité de backlog : `CRM-062`.
- Modèle : `docs/SCHEMA.md` §5 (`cards`), §4 (`workflow_nodes_catalog`, `workflow_steps`).
- Règles d'autorisation : `docs/SPEC-permissions-rls.md` §3.7 (`app.can_read_card`).
- Ordonnancement : `docs/SPEC-scheduler.md` (`CRM-017`).
- Interface existante qui porte déjà la notion : `docs/SPEC-workflow-engine.md` §7.4 (pastille
  d'ancienneté du board), `docs/DESIGN_SYSTEM.md` §5.1.
- Manuel : `docs/manual.md` chapitre 30.
- Ordonnanceur livré dont la tranche 2 réemploie le mécanisme : `docs/SPEC-scheduler.md` §3
  (démarrage observable), §4 (fermeture des privilèges), §5 (convergence).
- État : **tranche 1 livrée** (§1 à §6), **tranche 2 spécifiée au §9** le 2026-08-24 après mesure
  sur la pile debout et seedée, avant sa première ligne de code. La tranche 3 est esquissée au
  §7.3 et **non spécifiée**.

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

L'écran qui liste les affaires figées de l'appelant, son entrée de navigation, le chapitre 30 du
manuel, les captures aux quatre paliers, et **l'extension du seed** que le §5 a nommée : une seule
card figée ne démontre ni classement, ni regroupement.

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
| Harnais | `scripts/verify-relances.sh` étendu, non complaisant : la dégradation de l'idempotence, celle de la fermeture des privilèges et celle de la cadence du job doivent chacune faire rougir la suite, et la restauration est **constatée** |
| Seed | `scripts/verify-seed-demo.sh` ou le harnais dédié constate qu'après application du seed la card `5eed…00c3` porte exactement **un** `stalled`, écrit par la fonction et non par une fixture |

### 9.11 Retour arrière

Le retour arrière de la migration `0054` désordonnance `p2enjoy-relances-cards-figees`, supprime
`app.relancer_cards_figees()`, puis **laisse les événements `stalled` déjà écrits** : ce sont des
faits d'histoire, et `card_events` est immuable par construction. Le `CHECK` conserve donc ses
quinze valeurs ; le rétrécir invaliderait des lignes existantes. `pg_cron` n'est pas désinstallé,
d'autres jobs y vivent (`docs/SPEC-scheduler.md` §7).
