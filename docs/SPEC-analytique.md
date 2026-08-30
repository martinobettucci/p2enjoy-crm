# Spécification — Analytique de conversion et prévisionnel pondéré

Unité de backlog : `CRM-066` (`docs/BACKLOG.md`). Proposition d'origine : `CRM-P02`, « score de
santé transparent », retenue par la décision 299 et rattachée à cette unité.

Documents liés : `docs/SCHEMA.md` §4 (`workflow_nodes_catalog`, `workflow_steps`), §5 (`cards`),
§9 bis.9 (`public.cards_figees`, dont cette unité reprend la forme) ; `docs/SPEC-workflow-engine.md`
§2 (catalogue de nœuds) et §3.3 (résolution d'un attribut d'étape) ; `docs/SPEC-permissions-rls.md`
§3.6, §3.7 et §7 (le refus est **zéro ligne**) ; `docs/SPEC-costs.md` §2.3 (« nul n'est pas zéro »)
et §4.5 (un cumul se calcule **après** la RLS) ; `docs/SPEC-relances.md` §2.2 (un seuil absent n'est
jamais remplacé par un défaut) ; `docs/SPEC-webapp.md` §5.2 (routes) ; `docs/manual.md` chapitres 28
et 29.

Ce document est écrit **après mesure sur la pile de développement seedée**, et non de mémoire. Les
sept mesures du §2 ont été relevées le 2026-08-30 avant sa rédaction. Il est écrit et committé
**avant toute ligne de code**, conformément à `CLAUDE.md` §5 et à `docs/CloudWorker.md` §3.2.

---

## 1. Objet et périmètre

`CRM-066` livre deux lectures du portefeuille d'affaires, et rien d'autre :

- **l'entonnoir de conversion** — combien d'affaires actives se tiennent à chaque nœud du workflow,
  par channel et par track, et quelle part des affaires **décidées** a été gagnée ;
- **le prévisionnel pondéré** — la somme des montants des affaires ouvertes, chacune multipliée par
  sa probabilité effective, par devise présente.

### 1.1 Dans le périmètre

| Élément | Motif |
|---|---|
| La **probabilité effective** d'une affaire, résolue à trois niveaux (§3) | Trois colonnes existent et **aucune surface ne les lit** — mesure M4 |
| `public.entonnoir_conversion()`, agrégat serveur sous l'identité de l'appelant (§5) | `CLAUDE.md` §21 : ne pas télécharger tout le portefeuille pour l'écarter côté client |
| Le contrat d'API opposable de cette fonction (§6) | `CLAUDE.md` §10 : une règle de produit s'applique là où l'interface ne peut pas être contournée |
| Les deux grandeurs dérivées — taux de conversion des affaires décidées, prévisionnel par devise (§7) | `docs/manual.md` chapitres 28 et 29 |
| L'écran `/pilotage` et ses états (§8, tranche 3) | `docs/SPEC-webapp.md` §5.2 |
| Le seed portant les deux surcharges de probabilité (§9) | `CLAUDE.md` §8 : une règle métier neuve se démontre sur des données seedées |

### 1.2 Hors périmètre, et nommé comme tel

| Élément | Motif, ou unité qui le porte |
|---|---|
| Le **score de santé** (`cards.health_score`) | `CRM-P02`. Rattaché à cette unité, livré par sa **tranche 4** (§10). Aucune ligne ne l'alimente aujourd'hui — mesure M5 |
| Une analyse de **cohortes** — « des affaires entrées en janvier, quelle part est gagnée ? » | §11.1. Elle exige une lecture de `card_events` que cette unité ne fait pas, et la nommer « taux de conversion » sans la faire serait le mensonge que le §7.1 refuse |
| Toute **conversion de devises** | §11.2. Aucun taux de change n'existe dans le dépôt, et en inventer un ferait dire à un total un nombre que personne n'a arbitré |
| Le **digest** et le rapport hebdomadaire | `CRM-069` |
| Les **vues sauvegardées** et le préréglage de revue (`CRM-P08`) | `CRM-071` |
| Un objectif chiffré confronté au prévisionnel | `CRM-082` / `CRM-083` portent les objectifs ; leur confrontation au prévisionnel n'est **arbitrée nulle part** et n'est pas inventée ici (§11.3) |

## 2. Ce que la base porte déjà — sept mesures, relevées le 2026-08-30

Aucune de ces mesures n'est déduite. Chacune a été relevée sur la pile de développement montée par
`./runDev.sh` et seedée par `supabase/seed/apply-seed.sh`.

**M1 — le catalogue porte déjà la notion de terminal.** `workflow_nodes_catalog.kind` est contraint
à `open`, `won` ou `lost` (`CHECK` mesuré). Le seed pose **huit** nœuds, dont sept actifs :
`prospection` (open), `relance` (open), `negociation` (open), `signature` (open), `realisation`
(open), `livre` (**won**), `perdu` (**lost**), et `qualification` archivé.

**M2 — le catalogue porte déjà une probabilité par défaut.** `default_probability numeric(5,2)`,
contrainte entre 0 et 100, **nullable**. Valeurs seedées : 10, 20, 50, 90, 100, 100 (`livre`), 0
(`perdu`).

**M3 — deux surcharges existent au-dessus.** `workflow_steps.probability_override` et
`cards.probability_override`, mêmes type et contrainte, toutes deux nullables. Elles forment avec M2
une résolution à trois niveaux **identique de forme** à celle du seuil d'ancienneté
(`stale_after_days`) que `public.cards_figees()` applique depuis `CRM-062`.

**M4 — aucune de ces trois colonnes n'a de consommateur.** Recherche sur `webapp/src` : les seules
occurrences de `probability_override` sont des commentaires de `colonnes-liste.ts`, `entete-card.ts`
et `colonnes-board.ts` disant que la colonne est **hors** de leur périmètre, et les écrans
d'administration qui la **saisissent**. Rien ne la lit pour en faire un nombre.

**M5 — `cards.health_score` n'est alimentée par rien.** Colonne `integer` nullable ; aucune ligne du
seed ne la porte, aucun trigger ne l'écrit, aucun module de la webapp ne la lit. Le constat est déjà
écrit au backlog de `CRM-034` — « `health_score` et `snoozed_until` restent jamais alimentées » — et
`snoozed_until` en est sortie depuis `CRM-081`.

**M6 — le portefeuille seedé est riche et à deux devises.** 41 cards, dont **39 actives** — une en
corbeille (`Saisie erronée`) et une archivée (`Contrat cadre 2025`). Deux devises présentes, `EUR` et
`CHF`. **Deux cards sans montant**, dont une active (`Piste entrante à qualifier`). L'entonnoir
attendu, tous droits confondus, **replié par nœud** — c'est la vue que l'écran montre, et non le
grain de la fonction, qui descend au channel (§5.1) et rend **seize** lignes sur ce même seed :

| Nœud | `kind` | Devise | Affaires | Sans montant | Montant | Pondéré |
|---|---|---|---|---|---|---|
| Prospection | open | EUR | 11 | 1 | 294 200,00 | 29 420,00 |
| Relance | open | CHF | 1 | 0 | 47 000,00 | 9 400,00 |
| Relance | open | EUR | 8 | 0 | 284 350,00 | 56 870,00 |
| Négociation | open | EUR | 9 | 0 | 366 850,00 | 230 752,50 |
| Signature | open | CHF | 1 | 0 | 28 000,00 | 25 200,00 |
| Réalisation | open | EUR | 1 | 0 | 64 000,00 | 64 000,00 |
| Livré | **won** | EUR | 7 | 0 | 311 000,00 | 311 000,00 |
| Perdu | **lost** | EUR | 1 | 0 | 31 000,00 | 0,00 |

Somme des affaires : **39**, égale au décompte des cards actives. Prévisionnel des seules affaires
ouvertes : **381 042,50 EUR** et **34 600,00 CHF**. Affaires décidées : 7 gagnées, 1 perdue.

**RÉVISÉ LE 2026-08-30 PAR LA TRANCHE 2 c, ET LE TABLEAU CI-DESSUS EST CELUI D'APRÈS.** Les deux
surcharges du §9 sont posées : l'étape `negociation` du workflow par défaut porte **65 %**, et
« Reprise du dossier Marchand » **30 %**. Le pondéré de `Négociation` passe donc de 183 425,00 —
la valeur qu'il avait quand le catalogue l'emportait partout — à **230 752,50**, et le prévisionnel
EUR de 333 715,00 à **381 042,50**. Le CHF est INCHANGÉ : aucune affaire en francs n'est à ce nœud.
Le montant, lui, ne bouge pas : une probabilité ne change pas ce qu'une affaire vaut, seulement ce
qu'on en espère. Un tableau de mesures qui survit à la donnée qu'il mesure est un tableau faux, et
c'est le §9 lui-même qui exige cette révision dans le même changement.

**M7 — la RLS fait déjà diverger les appelants, et la divergence est nommée à l'affaire près.** Avec
les jetons réels obtenus par la véritable route de connexion,
`GET /rest/v1/cards?archived_at=is.null&deleted_at=is.null` rend **39** lignes à l'administratrice,
**39** au business developer et **35** à la lectrice. Les quatre manquantes sont exactement les
affaires actives du channel `grands-comptes` : `Audit sécurité applicative` (prospection),
`Migration ERP Sogexia` et `Refonte du site vitrine` (relance), `Socle analytique — Vertuo` (livré).

Le mécanisme est celui du §3.3 bis de `docs/SPEC-permissions-rls.md`, et il est mesuré, pas déduit :
`track_members` pose `conseil-ia = none` pour Farida Nowak, et `channel_members` **rouvre**
`prospection` en `member`. Elle perd donc les quatre affaires de l'autre channel de ce track et
garde les deux de `prospection`. Camille Aubert porte la **même** ligne `conseil-ia = none` et n'en
est pas restreinte : un administrateur de workspace n'est jamais limité par un droit fin (§2.2).

Cette divergence est la propriété que le §5.3 rend structurelle, et que le contrat d'API du §6
mesure.

## 3. La probabilité effective — la règle, et son absence assumée

```
probabilite_effective = coalesce(cards.probability_override,
                                 workflow_steps.probability_override,
                                 workflow_nodes_catalog.default_probability)
```

**Le plus spécifique gagne**, comme partout dans ce produit : l'affaire, puis son étape, puis le
nœud du catalogue. C'est la résolution de `docs/SPEC-workflow-engine.md` §3.3, appliquée à une
seconde colonne.

**Une probabilité absente n'est JAMAIS remplacée par un défaut.** Si les trois niveaux sont nuls, la
probabilité est inconnue, et l'affaire ne contribue pas au montant pondéré : elle est **comptée à
part**, dans `affaires_sans_probabilite`. C'est mot pour mot la règle du seuil d'ancienneté
(`docs/SPEC-relances.md` §2.2) et celle du coût réel (`docs/SPEC-costs.md` §2.3, « nul n'est pas
zéro »). Substituer `0` transformerait « personne n'a dit ce que vaut cette affaire » en « cette
affaire ne vaut rien », et un prévisionnel qui ment par défaut est pire qu'un prévisionnel
incomplet.

**Un montant absent suit la même règle.** `cards.amount` nul n'est pas `0` : l'affaire est comptée
dans `affaires`, comptée dans `affaires_sans_montant`, et ne contribue ni au montant ni au pondéré. Le
§7.3 impose que l'écran le **dise**, comme le §4.4 de `docs/SPEC-costs.md` l'impose déjà aux barres
de coûts.

**Le montant pondéré n'existe que si les deux existent.** Une affaire ne contribue à
`montant_pondere` que si elle porte **et** un montant **et** une probabilité effective. Toute autre
règle ferait dépendre le total d'une valeur inventée.

## 4. Ce qui entre dans l'entonnoir — deux exclusions, et aucune troisième

Une affaire entre dans l'entonnoir si elle est **active** :

```
cards.archived_at is null  et  cards.deleted_at is null
```

**Une affaire en sommeil compte, et c'est une divergence VOULUE avec `public.cards_figees()`.** Cette
dernière exclut les cards dont `snoozed_until` est strictement future, parce qu'une relance
contredirait le seul geste que l'utilisateur a posé contre les relances (`docs/SPEC-relances.md`
§2.4). Ici, rien n'est relancé : le sommeil dit « ne me réveille pas », jamais « cette affaire n'est
plus au portefeuille ». L'écarter du prévisionnel ferait **disparaître un montant** d'un total du
seul fait qu'on a demandé le silence, ce qui est exactement la perte silencieuse que `CLAUDE.md` §18
interdit. La divergence est figée par une assertion, pas laissée à la prose.

Le seed la rend démontrable sans rien y ajouter : `Cadrage data — Groupe Vallier` porte un
`snoozed_until` **à dix jours**, et `Refonte du site vitrine` un `snoozed_until` **échu de deux
jours** — les deux dates étant posées relativement à l'instant du seed. La première est la preuve ;
la seconde n'en est pas une, une échéance échue ne protégeant plus, et le contrat du §6 le dit.

**Les nœuds terminaux ne sont pas exclus, ils sont RENDUS.** `won` et `lost` sont des lignes de
l'entonnoir comme les autres, porteuses de leur `kind`. C'est l'appelant — l'écran du §7 — qui
décide ce qu'il en fait : le prévisionnel ne somme que `open`, le taux de conversion ne regarde que
`won` et `lost`. La fonction **mesure**, elle n'arbitre pas ; et la deuxième définition de
« terminal » que `docs/SPEC-relances.md` §2.3 refusait d'écrire n'est pas écrite ici non plus.

**Les nœuds archivés du catalogue ne sont pas nommés.** `qualification` est archivé et aucune étape
ne s'y rattache — `workflow_steps_node_id_workspace_id_fkey` est `ON DELETE RESTRICT` et
`workflow_nodes_catalog_refuser_archivage_occupe` refuse d'archiver un nœud occupé. Un nœud archivé
ne peut donc porter aucune affaire, et une condition sur `archived_at` serait une condition sans
objet. Figé par une assertion.

## 5. Contrat de `public.entonnoir_conversion()`

### 5.1 Signature

```
public.entonnoir_conversion()
returns table (
  workspace_id               uuid,
  track_id                   uuid,
  channel_id                 uuid,
  node_id                    uuid,
  node_key                   text,
  node_label                 text,
  node_kind                  text,      -- open | won | lost
  node_position              numeric,
  currency                   text,
  affaires                   integer,
  affaires_sans_montant      integer,
  affaires_sans_probabilite  integer,
  montant                    numeric,
  montant_pondere            numeric
)
```

**`node_label` est celui du CATALOGUE, jamais le `label_override` de l'étape.** Une étape peut
renommer son nœud **à l'intérieur d'un workflow** (`workflow_steps.label_override`) ; l'entonnoir,
lui, compare des affaires **à travers** les workflows — c'est pourquoi `docs/MASTER_PLAN.md` §2 pose
que cette unité exige le catalogue partagé de `CRM-030`. Rendre le libellé de l'étape ferait porter
deux noms à une même colonne dès que deux workflows renomment différemment le même nœud. Figé par
une assertion.

**Les deux montants sont arrondis au centime**, une seule fois, sur la somme — jamais sur chaque
terme. `cards.amount` est `numeric(14,2)` et une probabilité `numeric(5,2)` : le produit brut porte
quatre décimales, qui ne sont pas de la monnaie. Sommer des valeurs déjà arrondies déplacerait
l'erreur d'arrondi dans le total ; arrondir le total une fois la laisse au centime près.

**Une ligne n'existe que si elle est peuplée.** Un nœud sans aucune affaire dans un channel donné ne
produit **aucune** ligne : émettre des zéros pour tous les couples possibles multiplierait le
résultat par le produit des cardinalités et **inventerait des devises** qu'aucune affaire ne porte.
L'écran de la tranche 3 compose la liste complète des nœuds depuis `workflow_nodes_catalog`, qu'un
membre lit déjà, et **nomme** ceux là où la fonction se tait.

> **RÉVISÉ le 2026-08-30 par la tranche 3 b, sur place plutôt que contourné** (`CLAUDE.md` §18).
> Cette phrase disait « et **affiche zéro** là où la fonction se tait ». Elle a été écrite avant que
> la tranche 3 a ne retienne un tableau **par devise**, et les deux ne se composent pas : un zéro
> posé dans le tableau d'une devise inventerait à ce nœud une devise qu'aucune affaire n'y porte —
> exactement ce que le paragraphe ci-dessus interdit à la fonction elle-même. Le §8 bis.5 tranche la
> forme : les nœuds vides sont **nommés**, sans devise et sans montant.

| | |
|---|---|
| Volatilité | `stable` — le corps ne lit pas `now()`, mais lit des tables ; `immutable` serait faux |
| `search_path` | vide, tous les objets pleinement qualifiés |
| Sécurité | **`security invoker`**, jamais `definer` — §5.3 |
| Privilèges | `execute` à `authenticated` et `service_role` ; **`anon` révoqué NOMMÉMENT** — §5.4 |
| Grain | une ligne par `(channel_id, node_id, currency)` réellement peuplé |
| Ordre | `node_position`, puis `currency`, puis `channel_id` |
| Paramètres | **aucun** — §5.2 |

### 5.2 Pourquoi aucun paramètre de portée

Trois portées sont attendues par `docs/manual.md` chapitre 28 : le workspace, un track, un channel.
Un paramètre `p_track_id` obligerait l'appelant à choisir sa portée **avant** de savoir ce que le
backend lui consent, et l'écran de la tranche 3 devrait faire trois appels pour montrer un
histogramme par track.

Le grain rendu est donc le plus fin dont l'écran a besoin, et les trois portées s'en déduisent par
sommation : le channel est une ligne, le track la somme de ses channels, le workspace la somme de
ses tracks. Le volume est borné par `channels × nœuds × devises présentes` — **seize** lignes
mesurées sur le seed pour 39 affaires, qui se replient en les **huit** de M6 —, et non par le nombre
d'affaires. C'est ce qui distingue cet agrégat d'un téléchargement du portefeuille, que `CLAUDE.md`
§21 interdit dès que le volume croît.

`inbox_arborescence()` (`CRM-057`) suit exactement cette forme : rendre l'arbre en un appel, et
laisser l'écran le replier.

### 5.3 `security invoker` est obligatoire, et c'est le point même de la fonction

En `security definer`, la fonction répondrait pour `postgres`, qui traverse toute la RLS, et rendrait
donc à chaque appelant le portefeuille de tout le monde — channels fermés par les droits fins de
`CRM-012` compris. **Un total est une divulgation** : un chiffre d'affaires prévisionnel qui inclut
une affaire interdite la divulgue par soustraction. C'est la règle que `docs/SPEC-costs.md` §4.5
écrit déjà pour les coûts, et elle vaut identiquement ici.

En `invoker`, la fonction n'ajoute **aucune** règle d'accès : elle hérite de la politique de lecture
de `cards`, donc d'`app.can_read_card`. Le refus se mesure comme **zéro ligne**, jamais comme une
erreur — la forme exigée par les preuves de refus n° 3 et n° 4 de `docs/SPEC-permissions-rls.md` §7.

Conséquence mesurable et exigée : sur le seed, l'administratrice et le business developer obtiennent
un entonnoir totalisant **39** affaires sur 16 lignes, la lectrice **35** sur 13. Trois lignes
repliées de son entonnoir diffèrent, et **elles sont nommées** — `prospection`/EUR passe de 11 à 10,
`relance`/EUR de 8 à 6, `livre`/EUR de 7 à 6 —, tandis que `negociation`, `signature`, `realisation`
et `perdu` sont **identiques**. Son prévisionnel vaut **344 892,50 EUR** là où celui de
l'administratrice vaut **381 042,50 EUR**, les deux portant le même **34 600,00 CHF**. Deux appelants
n'obtiennent pas le même prévisionnel, et c'est correct.

Les deux nombres ont été **révisés par la tranche 2 c**, qui a porté le pondéré de `negociation` à
230 752,50 : ils valaient 297 565,00 et 333 715,00 quand le catalogue l'emportait partout. L'ÉCART
ENTRE EUX, LUI, EST INCHANGÉ — 36 150,00 EUR —, et c'est ce qui devait l'être : les quatre affaires
que la lectrice ne voit pas sont à `prospection`, `relance` et `livre`, aucune à `negociation`.

### 5.4 `anon` est révoqué nommément

`pg_default_acl` porte `alter default privileges in schema public … on functions to anon` : toute
fonction neuve de `public` naît avec `anon=X`, et `revoke … from public` ne lui retire **rien**,
`public` étant le pseudo-rôle et `anon` un rôle nommé. Le point de sûreté a été payé par la
migration 53 (`public.cards_figees`), qui rendait `200` et `[]` là où son contrat annonçait `401`.

L'appelant anonyme est donc refusé **par le privilège**, avant toute politique : `401` et `42501` à
travers PostgREST. C'est plus strict qu'un tableau vide, et c'est l'ACL de `public.etat_messagerie`,
`public.previsualiser_exigence` et `public.cards_figees`.

### 5.5 Ce que la fonction ne fait pas

- **Elle n'écrit rien.** Aucune table n'est créée ni modifiée, aucune colonne n'est ajoutée, aucune
  politique n'est touchée, aucun trigger n'est posé.
- **Elle n'additionne pas deux devises.** Le grain les sépare ; §11.2.
- **Elle ne classe pas les affaires par ancienneté**, ne calcule aucun retard et ne lit pas
  `entered_step_at` : c'est `public.cards_figees()` qui porte cette lecture, et la dupliquer créerait
  une seconde définition de « figée ».

## 6. Contrat d'API — les lignes que la preuve rejoue

Mesuré hors interface, avec les jetons réels obtenus par
`POST /auth/v1/token?grant_type=password`. Ce tableau est le contrat que
`e2e/api/analytique.spec.ts` rejoue ligne à ligne.

**Les appels sont émis en `POST /rest/v1/rpc/entonnoir_conversion`**, idiome de ce dépôt pour une
RPC. La fonction étant `stable`, PostgREST l'expose **aussi** en `GET`, et le refus anonyme de la
ligne *a* a été mesuré dans les **deux** formes : `401` et `42501` dans l'un comme dans l'autre —
un privilège ne dépend pas du verbe.

| Ligne | Appelant | Requête | Attendu |
|---|---|---|---|
| a | anonyme | `GET /rest/v1/rpc/entonnoir_conversion` | **`401`**, `42501` — refus par le privilège (§5.4), jamais un tableau vide |
| b | administratrice | idem | `200`, **16 lignes**, somme des `affaires` = **39** |
| c | administratrice | idem | Repliées par `(node_key, currency)`, les 16 lignes rendent exactement les **huit** de M6, avec leurs montants |
| d | administratrice | idem | Ordre rendu : `node_position` croissante, puis `currency` — deux appels successifs rendent la **même** suite |
| e | business developer | idem | Somme des `affaires` = **39** — identique à *b*, le seed ne lui fermant aucun track |
| f | **lectrice** | idem | **13 lignes**, somme des `affaires` = **35**. Aucune ligne du channel `grands-comptes` ; repliées, `prospection`/EUR 11 → **10**, `relance`/EUR 8 → **6**, `livre`/EUR 7 → **6** ; `negociation`, `signature`, `realisation` et `perdu` **identiques** à *b*. Son prévisionnel vaut **344 892,50 EUR** contre 381 042,50 à *b*, et **34 600,00 CHF** dans les deux cas |
| g | lectrice | idem | `200` et non `403` : le refus est **zéro ligne**, jamais une erreur (`docs/SPEC-permissions-rls.md` §7) |
| h | clé de service | idem | Somme des `affaires` = **39** — contre-épreuve établissant que les lignes que la lectrice ne voit pas **existent** (décision 50) |
| i | administratrice | idem | La ligne `prospection`/`EUR` porte `affaires_sans_montant` = **1** et `montant` = **294 200,00** : le montant nul n'a pas été compté comme zéro |
| j | administratrice | idem | Aucune ligne ne porte la card en corbeille ni l'archivée : la somme d'`affaires` vaut **39** et non 41 |
| k | administratrice | idem | `Cadrage data — Groupe Vallier`, **encore endormie** (`snoozed_until` à dix jours), est comptée dans `prospection`/EUR — §4. La seconde card seedée avec un sommeil, `Refonte du site vitrine`, a une échéance **échue** : elle est éveillée de fait, et sa présence ne prouverait rien |
| l | administratrice | idem | `montant_pondere` de `perdu` vaut **0,00** et non nul : la probabilité **est** connue et vaut zéro |
| m | administratrice, après surcharge d'étape | idem | La surcharge de `workflow_steps` l'emporte sur `default_probability` — §3 |
| n | administratrice, après surcharge de card | idem | La surcharge de `cards` l'emporte sur celle de l'étape — §3 |
| q | administratrice, **sans rien écrire** | idem | Les trois niveaux tels que le SEED les pose (§9) : `dossiers-2023`/`negociation` rend **6 600,00** — 22 000,00 × 30 %, la surcharge d'affaire —, `refonte`/`negociation` rend **46 800,00** — 72 000,00 × 65 %, la surcharge d'étape, sur la MÊME étape —, et le nœud entier **230 752,50**, jamais 183 425,00 |

Les lignes *m* et *n* écrivent puis **restaurent** l'état qu'elles ont trouvé : une preuve rend le
produit dans l'état où elle l'a pris (décision 501).

**LA LIGNE *q* EST AJOUTÉE PAR LA TRANCHE 2 c, ET ELLE N'ÉCRIT RIEN.** Les lignes *m* et *n* posent
leurs surcharges puis les retirent : elles éprouvent la **règle**, et resteraient vertes sur un seed
qui n'exercerait aucun niveau au-delà du catalogue. La ligne *q* lit ce que le seed porte : elle
éprouve la **donnée**, ce que `CLAUDE.md` §8 exige d'une règle métier neuve. Les trois nombres sont
mesurés sur une pile seedée à froid.

## 7. Les deux grandeurs dérivées

Elles ne vivent **pas** en base : ce sont des rapports de nombres que la fonction rend déjà, et les
calculer côté serveur imposerait une seconde définition à maintenir. Elles vivent dans
`webapp/src/lib/analytique.ts`, avec leur suite unitaire (tranche 2 b).

### 7.1 Taux de conversion des affaires décidées

```
decidees = somme des `affaires` sur les lignes de kind 'won' et 'lost'
taux     = si decidees > 0 : gagnees / decidees, sinon INCONNU
```

**Il s'appelle « taux de conversion des affaires décidées », et jamais « taux de conversion » tout
court.** Ce que ce nombre mesure est la part gagnée parmi les affaires **actuellement** à un nœud
terminal — pas la part gagnée parmi les affaires entrées dans une période. Les deux diffèrent dès
qu'une affaire décidée est archivée, et le seed en porte une : `Contrat cadre 2025`, gagnée puis
archivée, ne compte dans **ni l'un ni l'autre** de cet écran. Le §11.1 dit ce qu'il faudrait pour la
seconde lecture ; l'appeler du nom de la seconde en n'en faisant que la première serait le compteur
complaisant que `docs/CloudWorker.md` §4.1 bis refuse.

**Zéro affaire décidée rend INCONNU, pas 0 %.** Un taux de 0 % dit « tout a été perdu » ; l'absence
de toute décision ne dit rien. L'écran affiche alors sa mention d'indisponibilité, pas un nombre.

### 7.2 Prévisionnel pondéré, par devise

```
previsionnel[devise] = somme de `montant_pondere` sur les lignes de kind 'open' de cette devise
```

Les nœuds terminaux en sont **exclus** : une affaire gagnée n'est plus une prévision, une affaire
perdue vaut zéro et l'inclure ne changerait rien tout en laissant croire qu'elle compte. Sur le
seed, depuis la tranche 2 c : **381 042,50 EUR** et **34 600,00 CHF** — 333 715,00 EUR avant que les
deux surcharges du §9 ne soient posées.

### 7.3 Ce que l'écran doit dire, et qu'un total ne dit pas

Trois mentions sont **obligatoires**, sur le modèle de `docs/SPEC-costs.md` §4.4 :

1. « *n* affaires sans montant » dès que `affaires_sans_montant` est non nul dans la portée affichée —
   sans quoi un prévisionnel bas se lit comme un portefeuille pauvre au lieu d'un portefeuille mal
   renseigné ;
2. « *n* affaires sans probabilité » dès que `affaires_sans_probabilite` est non nul ;
3. le **nombre d'affaires** de chaque nœud, à côté du montant — un montant nu dans une liste sans
   en-têtes ne dit pas de quoi il est le nombre (défaut mesuré à la tranche 3 de `CRM-084`,
   décision 540).

## 8. Écran `/pilotage` — ce qui est arrêté, et ce qui ne l'est pas

**Arrêté ici** : l'adresse est `/pilotage`, route de **premier niveau** portée par une entrée de la
barre latérale, au même titre que `/couts` et `/ma-journee`. Motif identique à celui écrit pour
`/couts` dans `docs/SPEC-webapp.md` §5.2 : un tableau de pilotage n'administre rien, il porte le
travail. Elle figure dans `ROUTES` — son titre est une clé de traduction et son contenu ne dépend
d'aucun paramètre d'adresse ; la portée éventuelle vit dans la chaîne de requête, comme `?qui=tous`
de `/ma-journee`.

**Non arrêté ici, et délibérément** : la forme de l'entonnoir, ses composants, ses paliers
responsive, son parcours clavier et ses états. Ils sont écrits par la **tranche 3**, dans
`docs/DESIGN_SYSTEM.md`, **avant** sa première ligne de code — la lecture intégrale du design system
qu'impose `CLAUDE.md` §4 appartient à la session qui livre l'écran, et l'anticiper depuis une
session qui livre la base produirait une règle visuelle qu'aucune preuve n'exercerait.

**ARRÊTÉ LE 2026-08-30 PAR LA TRANCHE 3 a, ET LA RÈGLE VIT AU §5.48 DU DESIGN SYSTEM.** Trois blocs
— les deux grandeurs en liste de définitions, l'entonnoir en **tableau du §5.9 par devise** dans
l'ordre du catalogue, puis les deux mentions du §7.3 et la phrase de portée. Le titre de devise est
celui du §5.33, rendu **seulement** s'il y en a plusieurs. Aucun lien, aucune commande d'écriture,
aucune colonne triable, et un refus jamais déguisé en vide. L'entrée de barre latérale porte `Gauge`
et suit « Coûts ».

**LA PORTÉE EST CELLE DU WORKSPACE, ET LA TRANCHE 3 a NE LIVRE AUCUN SÉLECTEUR.** La phrase
ci-dessus — « la portée éventuelle vit dans la chaîne de requête » — reste vraie et **reste due** :
le module porte déjà `restreindre`, éprouvé par sa suite unitaire, mais nommer un track ou un
channel demande une **seconde lecture** que cette tranche ne fait pas. L'écart est écrit à l'écran,
dans la phrase de portée, plutôt que laissé à deviner.

**LA COMPLÉTION PAR LE CATALOGUE ANNONCÉE AU §5.1 N'EST PAS LIVRÉE NON PLUS, ET ELLE POSE UNE
QUESTION QUE LE §5.1 NE TRANCHE PAS.** Ce paragraphe écrit que l'écran « compose la liste complète
des nœuds depuis `workflow_nodes_catalog` […] et affiche zéro là où la fonction se tait ». Or les
tableaux sont **par devise** : compléter à l'intérieur de l'un d'eux rendrait `Négociation / CHF /
0` — c'est-à-dire **inventerait une devise à un nœud qu'aucune affaire n'y porte**, exactement ce
que le même §5.1 interdit à la fonction ; et compléter hors des devises demanderait de mêler deux
monnaies dans une colonne, ce que le §11.2 interdit. La tranche 3 b tranche la forme **avant**
d'écrire la seconde lecture. Aujourd'hui, un nœud sans aucune affaire active est **absent** des
tableaux, jamais rendu à zéro : un zéro affirmerait une mesure que l'écran n'a pas faite.

## 8 bis. Tranche 3 b — le sélecteur de portée, et la complétion par le catalogue

Le §8 renvoyait à cette tranche **deux** arbitrages de forme, qu'il refusait de trancher depuis une
session qui ne livrait pas encore l'écran. Ils sont tranchés ici, **avant** la première ligne de
code de la tranche (`docs/CloudWorker.md` §3.2 point 3, `docs/CloudWorker.md` §4.1 bis), et d'après
des mesures relevées sur la pile seedée le 2026-08-30 — non de mémoire.

### 8 bis.1 Quatre mesures, relevées avant l'arbitrage

| | Mesure |
|---|---|
| **M8** | `channels_track_id_slug_key` — `UNIQUE (track_id, slug)`. **Un slug de channel n'est unique QUE dans son track**, jamais dans l'espace de travail, là où `tracks_workspace_id_slug_key` rend le slug d'un track unique dans le workspace |
| **M9** | Le seed porte **quatre** tracks et **huit** channels, dont **deux** sont hors sélecteur : `appels-offres` est archivé, `annexes-2023` est en corbeille. Restent **six** channels offrables sur quatre tracks |
| **M10** | L'entonnoir de l'administratrice rend **16 lignes** touchant **sept** des **huit** nœuds du catalogue. `qualification` (position 8) n'est porté par **aucune** affaire active : c'est le cas de complétion, réellement présent dans le jeu de démonstration |
| **M11** | Restreint au track `studio-web`, l'entonnoir ne touche que cinq nœuds — `signature`, `perdu` et `qualification` en sont absents ; restreint au channel `legacy-2023 / dossiers-2023`, il n'en touche qu'**un**, `negociation`, pour **22 000,00 × 30 % = 6 600,00** |

### 8 bis.2 L'adresse porte DEUX clés, et M8 l'impose

```
/pilotage                                  → portée workspace (le défaut)
/pilotage?track=studio-web                 → portée track
/pilotage?track=studio-web&channel=refonte → portée channel
```

**`channel` seul ne désigne rien, et ce n'est pas un oubli : c'est M8.** Un slug de channel n'étant
unique que dans son track, `?channel=prospection` peut désigner deux channels de deux tracks
différents. Une clé unique aurait donc exigé soit un identifiant technique dans l'adresse — que le
produit n'écrit nulle part —, soit un slug composé, que rien dans le dépôt ne pose. Le couple
`(track, channel)` est exactement l'adressage que le produit emploie déjà pour un channel :
`/tracks/:slugTrack/:slugChannel` (`webapp/src/app/chemins.ts`). **Deux écrans qui désignent la même
chose la désignent de la même façon.**

**Le défaut ne s'écrit jamais dans l'adresse** — règle du §17.2 de `docs/SPEC-webapp.md`, déjà tenue
par `?qui=tous` de `/ma-journee` : `/pilotage` nu EST la portée workspace, et la vue par défaut
reste l'adresse la plus courte.

**Une valeur que la lecture ne résout pas replie sur le workspace, SANS erreur.** Un slug inconnu,
un track qui n'est pas lisible, un `channel` sans son `track` : l'écran rend l'espace de travail
entier et le **sélecteur montre la portée réellement appliquée**. Une adresse tapée à la main n'est
pas une panne (`docs/SPEC-webapp.md` §17.2), et le repli n'est pas silencieux **à l'œil** — c'est
précisément ce que le sélecteur et la phrase de portée disent. Afficher « ce track n'existe pas »
renseignerait par la bande sur ce que la RLS ferme, ce que le §5.48 du design system interdit déjà.

### 8 bis.3 La portée ne relit RIEN, et c'est une propriété du §5.2

Changer de portée **n'émet aucune requête**. La fonction rend déjà le grain le plus fin (§5.2), le
module porte `restreindre` (tranche 2 b, éprouvé), et les trois portées se déduisent par sommation.
Un appel par portée aurait fait de ce sélecteur un filtre serveur, c'est-à-dire une seconde
définition de la restriction — le mode de défaillance qu'INC-138, INC-241 et la décision 560 ont
déjà coûté au dépôt.

**Conséquence opposable : les deux grandeurs dérivées et les deux mentions suivent la portée.** Le
prévisionnel, le taux, les affaires sans montant et les affaires sans probabilité sont calculés sur
les lignes **restreintes**, jamais sur les lignes lues. Un prévisionnel de workspace au-dessus d'un
entonnoir de channel serait un écran qui ment sur ce qu'il montre.

### 8 bis.4 Ce que la seconde lecture lit, et l'unique limite qu'elle porte

Une requête, sur `channels`, avec son track imbriqué — la forme **mesurée** de
`lireChannelsLiables` (`webapp/src/lib/objectifs-ecriture.ts`), dont le nom de contrainte
`channels_track_id_workspace_id_fkey` a déjà été payé contre l'API. Les archivés et ceux de la
corbeille sont écartés, convention de `lireChannels` — M9.

**Ce n'est PAS un contrôle d'autorisation** (`CLAUDE.md` §10). La liste est celle que la RLS de
`channels` consent ; le module n'y ajoute aucun droit. Un channel fermé à l'appelant n'est ni offert
ni nommé, et une portée qu'il forcerait dans l'adresse ne lui rendrait rien de plus : l'entonnoir
est déjà calculé **après** la RLS (§5.3).

**LIMITE NOMMÉE : un channel dont le TRACK n'est pas lisible n'est pas offert.** L'adresse d'une
portée channel exige le slug de son track (§8 bis.2, M8) ; sans track lisible, il n'y a pas
d'adresse à écrire. Le sélecteur de destination des objectifs range un tel channel hors de tout
groupe parce qu'il n'a besoin que de son identifiant ; ici, l'adresse est le contrat, et un choix
qu'aucune adresse ne peut porter serait la commande morte du §5.10 du design system. L'écart est
écrit plutôt que tu.

**L'ÉCHEC DE CETTE LECTURE NE CASSE PAS L'ÉCRAN.** L'entonnoir est la lecture principale ; la liste
des portées ne sert qu'au sélecteur. Si elle échoue, l'écran rend le workspace et **désactive** son
sélecteur — la dérogation bornée du §5.22, déjà tenue par le champ « Channel visé » : il n'y a alors
rien à choisir, et un `select` vide mais actif serait une commande morte.

### 8 bis.5 La complétion par le catalogue — la forme tranchée, et pourquoi

Le §5.1 écrit que l'écran « compose la liste complète des nœuds depuis `workflow_nodes_catalog` […]
et affiche zéro là où la fonction se tait ». Cette phrase a été écrite **avant** que la tranche 3 a
ne retienne un tableau **par devise**, et les deux ne se composent pas : compléter dans le tableau
d'une devise rendrait `Qualification / CHF / 0`, c'est-à-dire **inventerait une devise à un nœud
qu'aucune affaire n'y porte** — ce que ce même §5.1 interdit à la fonction ; compléter hors des
devises mêlerait deux monnaies dans une colonne, ce que le §11.2 interdit.

**LA FORME RETENUE : les nœuds sans aucune affaire active dans la portée affichée sont NOMMÉS sous
les tableaux, sans devise et sans aucun montant, dans l'ordre du catalogue.** Ce que l'écran sait
d'un tel nœud est exactement cela : *aucune affaire ne s'y trouve*. C'est un **compte d'affaires**,
grandeur qui traverse licitement les devises parce qu'elle n'additionne aucun argent — le motif
exact pour lequel le §7.1 fait déjà traverser les devises au compte des affaires décidées. Une
colonne de montants, elle, ne le pourrait pas.

**Ce n'est pas un renoncement à la phrase du §5.1, c'est sa RÉVISION** (`CLAUDE.md` §18) : le §5.1
est corrigé sur place plutôt que contourné, et son « affiche zéro » devient « nomme les nœuds
vides ». Le trou de l'entonnoir est ce qui devait être montré ; l'affirmer par un « 0,00 » dans une
devise arbitraire aurait montré autre chose.

**MESURÉ, et le jeu de démonstration l'exerce vraiment** — M10 : `qualification`, huitième nœud du
catalogue, n'est porté par aucune affaire active de l'espace de travail. M11 : le track `studio-web`
en laisse **trois** vides, le channel `dossiers-2023` **sept**.

**Le catalogue est une TROISIÈME lecture, et elle est traitée comme la seconde** : son échec ne
casse pas l'écran — les tableaux sont rendus, et la mention des nœuds vides n'est simplement pas
écrite. Nommer un nœud vide est un enrichissement de la lecture, jamais sa condition.

## 9. Seed — ce que cette unité doit y ajouter

**Mesuré le 2026-08-30 (M3, M4), AVANT cette tranche : aucune card et aucune étape du seed ne
portait de `probability_override`.** La résolution à trois niveaux du §3 n'était donc démontrée qu'à
son troisième niveau. `CLAUDE.md` §8 exige qu'une règle métier neuve soit démontrable sur les
données de développement.

**LIVRÉ le 2026-08-30 par la tranche 2 c.** Le seed pose désormais les deux surcharges manquantes :

| Niveau | Objet | Valeur | Où elle est déclarée |
|---|---|---|---|
| 3 — le catalogue | nœud `negociation` | **50 %** | tableau `NOEUDS`, section 5 du seed |
| 2 — l'étape | étape 3 du workflow par défaut, `5eed…063` | **65 %** | tableau `ETAPES`, section 6 |
| 1 — l'affaire | « Reprise du dossier Marchand », `5eed…0cf` | **30 %** | tableau `SURCHARGES_PROBABILITE`, section 8 duodecies ter |

**LES TROIS VALEURS S'ENCADRENT — 30 < 50 < 65 —, ET C'EST CE QUI REND LA RÈGLE OPPOSABLE.** Trois
nombres distincts ne suffisent pas : s'ils croissaient du moins spécifique au plus spécifique, un
`greatest` rendrait exactement le même résultat que « le plus spécifique gagne », et aucune preuve
ne les distinguerait. Avec cet encadrement, chaque résolution fausse rend un nombre différent — un
`coalesce` écrit à l'envers rend 50, un `greatest` rend 65, un `least` rend 50 sur les huit autres
affaires du nœud.

**« Reprise du dossier Marchand » et pas une autre** : elle est la SEULE affaire active de
`dossiers-2023` au nœud `negociation`, si bien que la ligne de l'entonnoir qui la porte est
exactement son montant par sa probabilité — 22 000,00 × 30 % = 6 600,00 —, sans qu'aucune autre
affaire ne s'y mêle. C'est le même isolement qui rend « Cadrage data » lisible pour les lignes *k*,
*m* et *n*.

**LA SURCHARGE D'ÉTAPE EST POSÉE DANS LE CONTRAT DES ÉTAPES, ET NON PAR UN `PATCH` ULTÉRIEUR.** La
copie du workflow vers le track (section 7 du seed) recopie `probability_override`, et la version
publiée (section 8 undecies) photographie la composition : une surcharge écrite après elles ferait
diverger un seed appliqué à froid d'un seed rejoué. MESURÉ : la copie de `conseil-ia` porte bien
65 % elle aussi, `workflow_derivations.source_modified_since_copy` reste **faux**, et l'empreinte de
composition du workflow par défaut a **changé** — garde-fou de `0037_versionnement_workflows.test.sql`
révisé dans le même changement, jamais contourné.

Les totaux de M6, du §5.3, du §6 et du §7.2 sont révisés dans ce même changement — un tableau de
mesures qui survit à la donnée qu'il mesure est un tableau faux.

## 10. Découpage en tranches

Écrit ici plutôt que laissé à la mémoire d'une session (`CLAUDE.md` §5). Chaque tranche est livrable
et prouvable seule.

| Tranche | Contenu | État |
|---|---|---|
| **1 — la spécification** | Ce document, l'entrée de backlog de `CRM-066` et sa Definition of Done, `docs/JOURNAL.md` décision 562. Commit documentaire dédié, poussé avant tout code | **LIVRÉE** le 2026-08-30 |
| **2 a — la fonction** | `supabase/migrations/0073_entonnoir_conversion.sql`, sa suite pgTAP dédiée (27 assertions), son contrat d'API du §6 (16 scénarios), `docs/SCHEMA.md` §9 bis.11, `docs/PROD_MIGRATIONS.md` migration 73 | **LIVRÉE ET PROUVÉE** le 2026-08-30 |
| **2 b — le module** | `webapp/src/lib/analytique.ts` : lecture de la fonction, restriction de portée, repli par nœud et par devise, les deux grandeurs du §7, et sa suite unitaire (26 tests) | **LIVRÉE ET PROUVÉE** le 2026-08-30 |
| **2 c — le seed** | Les deux surcharges du §9, les compteurs et le tableau M6 révisés dans le même changement | **LIVRÉE ET PROUVÉE** le 2026-08-30 |
| **3 a — l'écran** | `/pilotage` à portée workspace, sa spécification visuelle au §5.48 de `docs/DESIGN_SYSTEM.md` écrite d'abord, ses tests de composant, son E2E d'interface à console vierge, ses captures **observées**, `docs/manual.md` chapitres 28 et 29 | **LIVRÉE** le 2026-08-30 |
| **3 b — la portée** | Le sélecteur de portée en chaîne de requête, sa seconde lecture et sa forme arrêtée au §8 bis.2 à §8 bis.4 | **ARBITRÉE** le 2026-08-30 (§8 bis) |
| **3 c — les nœuds vides** | La complétion par le catalogue, dont la forme est arrêtée au §8 bis.5 : les nœuds vides sont **nommés**, sans devise ni montant | **ARBITRÉE** le 2026-08-30 (§8 bis.5) |
| **4 — le score de santé** | `CRM-P02`. Il exige d'abord son arbitrage : ce qu'un score « transparent » agrège n'est écrit nulle part (§11.4) | — |

**Ce que la tranche 2 b décide, et qui n'est pas une reformulation du §7.** Les deux grandeurs vivent
dans le module et **non en base**, parce que ce sont des rapports entre des nombres que la fonction
rend déjà : les calculer côté serveur imposerait une seconde définition à maintenir, et c'est
exactement le mode de défaillance qu'INC-138, INC-241 et la décision 560 ont coûté au dépôt. Trois
choix s'y ajoutent, chacun figé par un test :

- **une devise dont toutes les affaires sont closes n'apparaît pas** dans le prévisionnel. « CHF :
  0,00 » se lirait comme une prévision nulle au lieu d'une absence de prévision ;
- **le taux porte `null` et jamais `0`** quand aucune affaire n'est décidée — le type le porte, de
  sorte qu'un `?? 0` de l'écran ne puisse pas effacer la distinction ;
- **le compte des affaires décidées traverse les devises**, et il est la seule grandeur du module à
  le faire : il n'additionne aucun argent.

## 11. Limites nommées, non masquées

### 11.1 Aucune analyse de cohortes

L'entonnoir est un **instantané** de l'état courant, pas une lecture d'histoire. `card_events` porte
bien les transitions — type `moved`, `payload` `{from_step_id, to_step_id}`, mesuré —, mais les
exploiter demanderait de définir une fenêtre, une date d'entrée dans le portefeuille et le sort des
affaires archivées entre-temps : trois arbitrages qu'aucun document ne rend. Sur le seed, `moved` ne
porte d'ailleurs que **deux** lignes, ce qui n'éprouverait rien. L'écart est nommé plutôt que
comblé par une approximation, et le §7.1 impose que le nom du nombre affiché dise laquelle des deux
lectures il est.

### 11.2 Aucune conversion de devises

Le seed porte `EUR` et `CHF`. Aucun taux de change n'existe dans le dépôt, aucun service n'en
fournit, et en figer un dans le code produirait un total faux le lendemain. Chaque devise a donc son
propre total, comme les histogrammes de coûts de `CRM-086`. Un total « toutes devises » n'est pas
affiché — un nombre qu'on ne sait pas calculer ne s'affiche pas approximativement.

### 11.3 Le prévisionnel n'est confronté à aucun objectif

`docs/manual.md` chapitre 29 s'intitule « Prévisionnel pondéré et **objectifs** ». Les objectifs
existent (`CRM-082`, `CRM-083`) sous forme de **tableaux de blocs et de flèches** ; rien dans
`docs/SPEC-goals.md` ne décrit un objectif **chiffré** qu'un prévisionnel viendrait remplir. Les
confronter exigerait d'inventer cette forme. `CRM-066` livre donc le prévisionnel seul ; le chapitre
29 le dira, et l'unité restera `[~]` tant que la confrontation n'aura pas été arbitrée — c'est le cas
3 de la liste fermée de `docs/CloudWorker.md` §4.1 bis : deux réponses raisonnables mènent à deux
produits différents.

### 11.4 Le score de santé n'est pas arbitré

`CRM-P02` demande un « score de santé **transparent** ». La colonne existe (M5) et rien ne l'écrit.
Ce qu'un tel score agrège — ancienneté dans l'étape, dernier contact, montant, probabilité, retard
de prochaine action — n'est écrit dans aucun document, et deux compositions raisonnables donnent
deux produits différents. La tranche 4 commence donc par son arbitrage et sa spécification, jamais
par du code.

### 11.5 Ce que la fonction ne protège pas

Un administrateur peut poser une `probability_override` incohérente avec le `kind` du nœud — 90 % sur
un nœud `lost`, par exemple. Le produit l'honore au lieu de le contredire en silence : c'est la même
posture que `docs/SPEC-relances.md` §2.3 tient pour le seuil d'ancienneté d'un nœud terminal. Figé
par une assertion, et non laissé à la prose.

## 12. Preuves attendues

`scripts/verify-analytique.sh` rejoue, sur une pile de développement démarrée et seedée :

1. **pgTAP dédiée** — `supabase/tests/0068_entonnoir_conversion.test.sql` : existence et signature de
   la fonction, sa volatilité, sa sécurité `invoker`, l'ACL des quatre rôles, la résolution à trois
   niveaux dans ses trois sens, les deux exclusions et **l'inclusion** de la card en sommeil, le
   montant nul non compté comme zéro, la probabilité nulle non remplacée, et le grain par devise.
   Son **groupe 6 bis**, ajouté par la tranche 2 c, éprouve la même résolution **sans rien écrire**,
   sur les surcharges que le seed pose (§9) : le groupe qui écrit prouve la règle, celui-ci prouve
   que la donnée l'exerce.
2. **Contrat d'API** — `e2e/api/analytique.spec.ts` rejoue les quinze lignes du §6 avec les jetons
   réels des trois profils, chaque refus éprouvé **contre** son succès correspondant. La ligne *q*
   est celle de la tranche 2 c, et elle est en lecture seule.
3. **Unitaires** — `webapp/src/lib/analytique.test.ts` : les deux grandeurs du §7, dont
   `decidees = 0` rendant **inconnu** et non `0 %`.
4. **Non-complaisance** — le harnais dégrade réellement le produit et doit échouer dans chaque cas :
   la fonction passée en `security definer` (la lectrice verrait alors 39 affaires), le `coalesce`
   de la probabilité réordonné, l'exclusion des archivées retirée, et le `filter` du montant pondéré
   remplacé par un `coalesce(amount, 0)`. Son **contrôle 8**, ajouté par la tranche 2 c, dégrade la
   **donnée** et non le code : la surcharge d'affaire retirée en base, la suite pgTAP doit rougir.
   Il **restaure** ensuite tout ce qu'il a altéré et le constate en sortant.
5. **E2E d'interface et captures** — tranche 3, avec sa console vierge et ses quatre paliers.
