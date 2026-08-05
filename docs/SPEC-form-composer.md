# Spécification — Form composer (champs conditionnels)

Unités de backlog : `CRM-035` à `CRM-037` (voir `docs/BACKLOG.md`).
Documents liés : `docs/SCHEMA.md` §4, `docs/SPEC-workflow-engine.md` §3 (étapes) et §5
(`move_card`), `docs/SPEC-permissions-rls.md` §4 et §7, `docs/SPEC-seed.md` §2,
`docs/DESIGN_SYSTEM.md` §5.7.

Les §2 et §3 ont été **réécrits après mesure** pendant `CRM-035`, le §6 pendant `CRM-036`, sur la
pile réelle : sondes créées puis détruites dans la base du seed, `SQLSTATE` et codes HTTP relevés à
la main, contrat d'API écrit avant le code pour être mesuré et non supposé. Ce qu'ils énoncent est
ce que la base tient, ni plus ni moins ; ce qu'elle ne tient pas est nommé au §2.4, au §2.10, au
§6.5 et au §6.12.

---

## 1. Intention

Chaque card affiche un formulaire dont les champs **dépendent de son étape courante**. Une card
en prospection ne demande pas les mêmes informations qu'une card en signature. Le formulaire est
donc une donnée attachée au workflow, pas un composant codé en dur.

Deux besoins distincts, souvent confondus, sont traités séparément :

- **Visibilité** : quels champs montrer à cette étape ?
- **Obligation** : quels champs doivent être renseignés **pour quitter** cette étape ?

## 2. Définition des champs — `CRM-035`

### 2.1 Ce qu'un champ est, et ce qu'il n'est pas

Un champ est une **question posée à propos d'une card**, déclarée une fois pour un workflow et
posée à chaque card qui le suit. Ce n'est pas une colonne : ajouter un champ n'exige aucune
migration, et deux workspaces n'ont aucune raison de poser les mêmes questions.

Les champs appartiennent à un **workflow**, pas à un channel : deux channels partageant un
workflow partagent son formulaire. C'est la conséquence directe de `docs/SCHEMA.md` §4, qui donne
à `form_fields` une colonne `workflow_id` et aucune colonne `channel_id`.

Ce qu'un champ **n'est pas**, et que `CRM-035` ne livre donc pas :

- il ne porte **aucune valeur**. Les valeurs vivent dans `card_field_values`, livrée par
  `CRM-036` ; `CRM-035` livre le **vocabulaire du formulaire**, pas ses réponses ;
- il n'**exige** rien par lui-même. L'obligation est portée par la règle (§3), et **appliquée**
  par `move_card` (`CRM-034`, `docs/SPEC-workflow-engine.md` §5). Tant que `move_card` n'existe
  pas, `required` est une **déclaration sans garde** : le dire est plus honnête que de laisser
  croire l'inverse ;
- il ne **valide** aucune valeur. La validation par type est `CRM-036` (§6). `CRM-035` garantit
  seulement que le **type déclaré** appartient à la liste du §2.3.

### 2.2 Modèle — `form_fields`

`docs/SCHEMA.md` §4, complété de `workspace_id`, `created_at` et `updated_at` que ses
« Conventions générales » exigent de toute table métier et que son tableau omet — **cinquième
occurrence** du même oubli, INC-025.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `workflow_id` | `uuid` | non nul ; clé étrangère **composite** avec `workspace_id` |
| `workspace_id` | `uuid` | non nul, dénormalisé pour la RLS ; sa véracité est garantie par la clé composite, non supposée |
| `key` | `text` | non nul, unique **par workflow**, `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `label` | `text` | non nul, non vide |
| `type` | `text` | non nul, `CHECK` sur les quinze valeurs du §2.3 |
| `options` | `jsonb` | non nul, défaut `{}`, **objet** JSON ; contraintes propres à `select`, `multiselect` et `money` (§2.4) |
| `help_text` | `text` | nullable, non vide si fourni |
| `position` | `numeric` | non nul **sans défaut de colonne** ; attribuée par trigger dans la portée du **workflow** si omise |
| `archived_at` | `timestamptz` | nullable ; non nul = archivé |
| `created_at`, `updated_at` | `timestamptz` | non nuls, `now()` ; `updated_at` par trigger |

L'unicité `(id, workflow_id)` est posée en plus de la clé primaire. Elle ne peut refuser aucune
ligne — `id` est déjà unique — et elle est la **condition** de la clé composite des règles (§3.3).
MESURÉ sur sonde : sans elle, la création de `form_field_rules` échoue en `42830`, « there is no
unique constraint matching given keys for referenced table ». C'est le même geste que
`workflows_id_workspace_id_key` et `workflow_steps_id_workflow_id_key`.

### 2.3 Types supportés, et ce que le type engage aujourd'hui

| Type | Rendu | Valeur stockée |
|---|---|---|
| `text`, `textarea` | Champ texte | chaîne |
| `number`, `money` | Champ numérique, `money` avec devise | nombre |
| `date`, `datetime` | Sélecteur | ISO 8601 |
| `select`, `multiselect` | Liste de choix définie dans `options` | clé ou tableau de clés |
| `checkbox` | Case | booléen |
| `url`, `email`, `phone` | Champ texte avec validation de format | chaîne |
| `user` | Sélecteur de membre du workspace | uuid |
| `contact` | Sélecteur de contact, création à la volée | uuid |
| `file` | Dépôt de fichier vers Storage | chemin |

Les valeurs sont stockées en `jsonb` dans `card_field_values` (`CRM-036`). Le type déclaré
détermine la validation ; une valeur qui ne correspond pas au type est refusée à l'écriture.

**Trois types désignent des objets qui n'existent pas encore**, et cela est déclaré plutôt que
tu : `contact` vise `contacts` (`CRM-060`), `user` vise `profiles` (livrée), `file` vise Storage.
Aucune intégrité référentielle n'est posée sur la **valeur** — elle vivra dans un `jsonb`, où
aucune clé étrangère n'est possible, exactement comme `require_fields` sur un `uuid[]` (INC-033).
Déclarer un champ de type `contact` est donc licite dès `CRM-035` ; le **résoudre** appartient à
`CRM-036` et à `CRM-060`. **`CRM-036` ne l'a pas résolu**, et le motif est écrit au §6.5 : `contacts`
n'existe pas, et résoudre `user` seul rendrait la famille incohérente tout en posant une règle que
nul document n'énonce. INC-053, arbitrage attendu.

### 2.4 Ce que `options` doit porter, et pourquoi la base l'exige

`options` est un **objet** JSON — `CHECK (jsonb_typeof(options) = 'object')`. Un tableau ou un
scalaire y serait un contrat que personne ne saurait lire.

Deux types ne sont pas utilisables sans leurs options, et la base le refuse plutôt que de laisser
naître un formulaire cassé :

| Type | Exigence | Motif |
|---|---|---|
| `select`, `multiselect` | `options->'choices'` est un tableau **non vide** | Le §2.3 dit « liste de choix définie dans `options` ». Une liste de choix vide n'est pas un champ, c'est une impasse d'interface |
| `money` | `options->>'currency'` présent, `^[A-Z]{3}$` | Le §2.3 dit « `money` avec devise ». Un montant sans devise n'est pas un montant |

Ce que la base **ne** vérifie **pas**, et qui reste au client : la forme de chaque entrée de
`choices` — `{key, label}` — et l'unicité des clés de choix. Un `CHECK` ne peut porter aucune
sous-requête, et déplier un tableau `jsonb` dans une contrainte exigerait une fonction dont
l'immutabilité serait à démontrer. La vérification de forme appartient donc au rendu (`CRM-037`)
et à la validation des valeurs (`CRM-036`), qui est le seul endroit où une clé de choix inconnue
produit une conséquence.

**Conséquence assumée pour l'éditeur** : un champ `select` naît avec au moins un choix. On ne peut
pas créer la question puis ses réponses en deux gestes. C'est le prix d'un formulaire toujours
rendable, et il est faible — les deux écritures partent du même écran.

### 2.5 La clé, et ce que l'archivage en fait

`key` est l'identifiant **durable** du champ : celui qu'un export, un filtre de vue sauvegardée ou
un message d'erreur de `move_card` nomme. Sa forme est celle des clés du catalogue de nœuds —
minuscules, chiffres, tirets simples — pour la même raison et par la même convention
(`docs/SPEC-workflow-engine.md` §2.3).

L'unicité est **totale par workflow**, et non partielle sur les champs actifs : un champ archivé
**garde sa clé réservée**. C'est le choix déjà fait pour le catalogue, et il vaut ici davantage
encore : les valeurs saisies survivent à l'archivage (§5), et réattribuer la clé d'un champ
archivé à un nouveau champ rendrait un export ambigu sans qu'aucune erreur ne le signale.

### 2.6 Ordre des champs

`position` est un `numeric` fractionnaire, attribué par trigger `BEFORE INSERT` dans la portée du
**workflow** lorsqu'il est omis — même mécanisme et même portée que `workflow_steps`
(`docs/SPEC-workflow-engine.md` §3.6). La colonne est `not null` **sans défaut de colonne** : un
défaut ferait de toute omission un `1`, là où le trigger place le champ en fin de formulaire.

Propriété héritée et vérifiée à nouveau plutôt que supposée : un trigger `BEFORE INSERT` reçoit
`position` à `NULL` que le client l'ait **omise** ou écrite explicitement, et ne peut pas
distinguer les deux cas.

### 2.7 Autorisations

`docs/SPEC-permissions-rls.md` §4 range `form_fields` et `form_field_rules` ensemble : lecture par
les **membres du workspace**, écriture par les **`admin`**. Aucun droit fin ne les gouverne — un
formulaire appartient à un workflow, et un workflow n'est ni un track ni un channel. La règle
s'arrête au rôle de workspace **par conception**, non par différé : aucune entrée d'incohérence
n'est ouverte à ce titre, contrairement à INC-024 et INC-030.

La lecture est accordée à `anon` **et** `authenticated` : sans jeton, `auth.uid()` est nul, le
prédicat rend faux, et le refus se manifeste par **zéro ligne** plutôt que par une erreur de
privilège (`docs/SPEC-permissions-rls.md` §7).

**Asymétrie de la suppression**, traduction de la décision 74 :

- un **champ** porte `archived_at`, et l'archivage tient lieu de suppression. Aucune politique
  `for delete`, aucun privilège `DELETE` : le refus est double. Supprimer un champ effacerait des
  valeurs saisies (§5) ;
- une **règle** est la composition d'un formulaire, sans existence propre et sans `archived_at`.
  Un éditeur qui ne peut pas retirer une règle ne peut pas éditer. La suppression lui est donc
  ouverte, aux `admin` seuls.

### 2.8 Contrat d'API attendu, à mesurer

Les lignes ci-dessous sont ce que `CRM-035` doit **mesurer** et non supposer ; elles sont écrites
avant le code, et les scénarios de `e2e/api/champs-formulaire.spec.ts` les rejouent une à une.

| # | Appel | Profil | Attendu |
|---|---|---|---|
| a | `GET /form_fields` | membre du workspace | `200`, les champs du seed |
| b | `GET /form_fields` | anonyme | `200` et `[]` — refus par zéro ligne, jamais par une erreur |
| c | `POST /form_fields` | `admin` | `201` |
| d | `POST /form_fields` | `business_developer` | `403` — un bizdev remplit le formulaire, il ne le dessine pas |
| e | `POST /form_fields` | `viewer` | `403` |
| f | `POST /form_fields` | anonyme | `401` — refus par le privilège, avant toute politique |
| g | `PATCH /form_fields` | `admin` | `200`, la ligne modifiée |
| h | `PATCH /form_fields` | `business_developer` | `200` **et aucune ligne modifiée** — un refus par `USING` ne lève aucune erreur (décision 70) ; la preuve relit la ligne |
| i | `DELETE /form_fields` | `admin` | `403` — aucun privilège `DELETE` n'est accordé, l'archivage tient lieu de suppression. **Mesuré** : `403` et non `401`, un rôle authentifié privé du privilège n'étant pas un appelant sans rôle (ligne f) |
| j | `POST /form_fields` avec un `workflow_id` d'un **autre** workspace | `admin` | refusé par la clé étrangère composite, `409` / `23503` |
| k | `POST /form_fields`, `type` hors liste | `admin` | `400` / `23514` |
| l | `POST /form_fields`, `select` sans `choices` | `admin` | `400` / `23514` |
| m | `POST /form_fields`, `money` sans `currency` | `admin` | `400` / `23514` |
| n | `POST /form_fields`, `key` déjà prise dans le workflow | `admin` | `409` / `23505` |
| o | `POST /form_field_rules` | `admin` | `201` |
| p | `POST /form_field_rules` | `business_developer` | `403` |
| q | `POST /form_field_rules`, champ et étape de **workflows différents** | `admin` | refusé par une clé composite, `409` / `23503` |
| r | `POST /form_field_rules`, `visibility` hors liste | `admin` | `400` / `23514` |
| s | `DELETE /form_field_rules` | `admin` | `204`, la ligne disparaît |
| t | `DELETE /form_field_rules` | `business_developer` | `204` **et la ligne reste** — même piège qu'en `h` |
| u | `GET /form_field_rules` | anonyme | `200` et `[]` |

### 2.9 Ce que le seed livre

`docs/SPEC-seed.md` §2 est le contrat opposable. Le seed pose, sur le workflow par défaut du
workspace :

- **six champs actifs** couvrant six types distincts — `money`, `select`, `date`, `textarea`,
  `checkbox`, `url` —, sans quoi les contraintes du §2.4 seraient documentées sans être
  démontrables ;
- **un champ archivé**, pour que l'état « archivé » le soit aussi côté formulaire et non seulement
  documenté (`CLAUDE.md` §8), comme un track, un channel et un nœud archivés avant lui ;
- **des règles couvrant les trois visibilités** — `hidden`, `visible`, `required` — et **des
  couples champ × étape sans règle**, qui démontrent la valeur par défaut du §3.1. Une valeur par
  défaut qu'aucune donnée n'exerce n'est pas démontrée.

`position` est écrite explicitement, pour le même motif que les tracks, les channels, les nœuds et
les étapes : un ordre attribué par effet de bord ne serait pas reproductible si l'ordre des
insertions changeait. Le trigger reste éprouvé par la suite pgTAP et par les scénarios d'API.

### 2.10 Ce que `CRM-035` ne livre pas, et qui est nommé

- **La copie des champs vers un track.** Le §2.1 dit que deux channels partageant un workflow
  partagent son formulaire ; la copie d'un workflow vers un track (`CRM-032`) crée un **nouveau**
  workflow, qui naît donc **sans aucun champ**. `copy_workflow_to_track` n'en copie aucun : elle a
  été écrite quand `form_fields` n'existait pas. Le comportement reste **inchangé** ici, et la
  conséquence devient réelle et mesurable — INC-037, dont l'arbitrage appartient au responsable et
  n'a pas été rendu. Elle est **figée par des assertions** plutôt que par un commentaire.
- **`require_fields` reste vide dans le seed.** La colonne peut désormais désigner des champs
  réels, mais aucune garde ne la lit : `move_card` est `CRM-034`. Une donnée de démonstration que
  rien n'exerce est une décoration, pas une preuve.
- **Aucun écran.** La grille champ × étape de la Definition of Done suppose un écran
  d'administration authentifié, et la webapp reste un appelant anonyme faute d'écran de connexion —
  INC-021, en attente d'arbitrage.

## 3. Règles conditionnelles — `form_field_rules`

### 3.1 Les trois visibilités, et la valeur par défaut

`form_field_rules` associe un champ et une étape à une visibilité :

| Valeur | Effet à cette étape |
|---|---|
| `hidden` | Le champ n'est ni affiché ni exigé |
| `visible` | Le champ est affiché, facultatif |
| `required` | Le champ est affiché et **exigé pour entrer dans cette étape** |

**Absence de règle pour un couple champ/étape : le champ est `visible`.** Ce choix évite d'avoir
à déclarer une règle par étape pour les champs courants. Il a une conséquence à retenir : le
formulaire d'une étape ne se lit **jamais** en listant les règles de cette étape, mais en listant
les **champs du workflow** puis en appliquant les règles trouvées. Une lecture par les règles
seules perdrait tous les champs par défaut.

### 3.2 Modèle

| Colonne | Type | Contraintes |
|---|---|---|
| `field_id` | `uuid` | PK composite ; clé étrangère **composite** avec `workflow_id` |
| `step_id` | `uuid` | PK composite ; clé étrangère **composite** avec `workflow_id` |
| `workflow_id` | `uuid` | non nul ; le workflow **commun** au champ et à l'étape |
| `workspace_id` | `uuid` | non nul, dénormalisé pour la RLS |
| `visibility` | `text` | non nul, `CHECK (visibility IN ('hidden','visible','required'))` |
| `created_at`, `updated_at` | `timestamptz` | non nuls, `now()` |

`workflow_id` n'est pas une commodité : il est **la charnière** des deux clés composites du §3.3.
Sans lui, la table ne pourrait pas exprimer que le champ et l'étape appartiennent au même
workflow, et aucun trigger ne le rattraperait aussi sûrement.

La clé primaire est `(field_id, step_id)`, conformément à `docs/SCHEMA.md` §4 : un couple champ ×
étape porte **au plus une** visibilité. Deux règles contradictoires sur le même couple sont
structurellement impossibles.

### 3.3 Ce que la base garantit structurellement — mesuré

Deux clés étrangères composites, et non simples :

```
(field_id, workflow_id) → form_fields      (id, workflow_id)   ON DELETE CASCADE
(step_id,  workflow_id) → workflow_steps   (id, workflow_id)   ON DELETE CASCADE
```

MESURÉ sur sonde, dans les **deux** sens : une règle liant un champ du workflow A à une étape du
workflow B est refusée quel que soit le `workflow_id` déclaré.

- `workflow_id` = A → `23503`, « Key (step_id, workflow_id)=(…) is not present in table
  "workflow_steps" » ;
- `workflow_id` = B → `23503`, « Key (field_id, workflow_id)=(…) is not present in table
  "form_fields" ».

Un trigger aurait rendu le même service, plus tard et moins sûrement (décision 73). MESURÉ
également : supprimer une étape emporte ses règles. C'est voulu — une règle portant sur une étape
disparue n'est pas une donnée à conserver.

Une troisième clé composite, `(workflow_id, workspace_id) → workflows (id, workspace_id)`, garantit
que le `workspace_id` dénormalisé **dit la vérité**. Une politique décide qui écrit la ligne, pas
ce que la ligne raconte (décision 73).

### 3.4 Sémantique de `required`

Un champ `required` sur l'étape *E* est exigé **au moment où une card entre dans *E***, contrôlé
par `move_card`. Il n'est pas exigé pour enregistrer une valeur partielle pendant que la card est
ailleurs : on n'empêche jamais un utilisateur de saisir progressivement ses informations.

Les données déjà existantes ne sont jamais invalidées rétroactivement : une card entrée dans *E*
avant l'ajout d'une règle `required` y reste, et le champ manquant est signalé dans l'interface
sans bloquer la lecture.

### 3.5 Champs exigés par une transition

Une transition peut exiger des champs supplémentaires (`workflow_transitions.require_fields`),
indépendamment de l'étape cible. L'ensemble effectivement contrôlé est l'union des champs
`required` de l'étape cible et des `require_fields` de la transition empruntée.

Aucune intégrité référentielle ne protège ce tableau, et cela ne changera pas maintenant que
`form_fields` existe : PostgreSQL refuse une clé étrangère depuis une colonne `uuid[]` — INC-033,
mesuré, propriété du type et non différé. Un identifiant de champ supprimé ou appartenant à un
autre workflow y survivrait sans que rien ne le signale. C'est `move_card` qui devra ignorer, ou
dénoncer, un identifiant qu'elle ne résout pas.

**TRANCHÉ PAR `CRM-036` : elle l'ignore**, et le motif est écrit au §6.7 — dénoncer bloquerait
définitivement une transition pour une erreur de saisie qu'aucun utilisateur ne peut corriger depuis
le produit. Le comportement est figé par une assertion.

## 4. Rendu

- Les champs sont ordonnés par `position`.
- Un champ `hidden` à l'étape courante **mais portant une valeur** est affiché dans une section
  repliée « Informations d'autres étapes », en lecture seule. Masquer purement et simplement une
  donnée saisie serait une perte d'information silencieuse.
- Un champ `required` porte un astérisque et la mention explicite « requis pour passer à
  <étape> » : l'utilisateur comprend la raison de l'obligation.
- Les erreurs sont affichées au niveau du champ, avec `role="alert"` et association
  `aria-describedby`.
- Lorsqu'une transition est refusée pour champs manquants, l'interface met en évidence les
  champs concernés et fait défiler jusqu'au premier.

## 5. Édition du formulaire

Réservée aux administrateurs, dans l'éditeur de workflow. Une grille champ × étape permet de
régler la visibilité de chaque couple en un seul écran, plutôt que champ par champ.

L'archivage d'un champ (`archived_at`) le retire des formulaires **sans supprimer les valeurs
déjà saisies**, qui restent consultables dans la section repliée et dans l'export.

## 6. Valeurs et validation — `CRM-036`

Ce chapitre a été **réécrit après mesure**, le 2026-08-05, sur la pile réelle : sondes créées puis
détruites, `SQLSTATE` et codes HTTP relevés à la main contre PostgreSQL `17.6.1.136` et PostgREST
`v14.12`. Il tenait auparavant en dix lignes, qui disaient *où* la validation vit sans jamais dire
sur quelles colonnes la table repose, ce qu'un refus rend, ce que « renseigné » veut dire, ni ce
qu'il advient d'une valeur portée par un champ archivé.

### 6.1 Ce qu'une valeur est, et ce qu'elle n'est pas

Une valeur est la **réponse d'une card à une question de son workflow**. Elle n'existe qu'au
croisement des deux : ni une colonne de `cards`, ni une propriété du champ.

Ce qu'elle **n'est pas**, et que `CRM-036` ne livre donc pas :

- elle n'est **pas rendue**. Le formulaire, sa section repliée et la mention « requis pour passer
  à » sont `CRM-037` (§4) ;
- elle ne porte **aucune intégrité référentielle sur son contenu**. Une valeur vit dans un `jsonb`,
  où aucune clé étrangère n'est possible — même propriété du type que pour `require_fields` sur un
  `uuid[]` (INC-033). Ce que `CRM-036` valide est la **forme**, pas l'existence de la cible (§6.5) ;
- elle n'a **aucune histoire**. Une valeur écrasée est perdue : la trace des modifications relève
  de `card_events` (`CRM-044`), qui n'existe pas.

### 6.2 Modèle — `card_field_values`

| Colonne | Type | Contraintes |
|---|---|---|
| `card_id` | `uuid` | PK composite ; clé étrangère **composite** avec `workflow_id` |
| `field_id` | `uuid` | PK composite ; clé étrangère **composite** avec `workflow_id` |
| `workflow_id` | `uuid` | non nul ; le workflow **commun** à la card et au champ — charnière des deux clés composites du §6.3 |
| `workspace_id` | `uuid` | non nul, dénormalisé pour la RLS ; sa véracité est garantie par une troisième clé composite |
| `value` | `jsonb` | non nul ; `'null'::jsonb` signifie **explicitement vide** (§6.6) |
| `updated_by` | `uuid` | nullable, FK `profiles`, `ON DELETE SET NULL` |
| `created_at`, `updated_at` | `timestamptz` | non nuls, `now()` ; `updated_at` par trigger |

La clé primaire est `(card_id, field_id)` : une card porte **au plus une** valeur par champ. Deux
réponses contradictoires à la même question sont structurellement impossibles, comme deux
visibilités pour un même couple champ × étape (§3.2).

`created_at` ne figure pas dans le tableau de `docs/SCHEMA.md` §4, qui n'énumère que `updated_at`.
C'est la **quatrième occurrence d'INC-025** : les « Conventions générales » du même document
imposent les deux horodatages à toute table métier. La table est livrée **avec les deux**, et le
tableau de `docs/SCHEMA.md` est corrigé dans le même changement.

### 6.3 Ce que la base garantit structurellement — mesuré

Trois clés étrangères composites, et non simples :

```
(card_id,     workflow_id) → cards        (id, workflow_id)   ON DELETE CASCADE
(field_id,    workflow_id) → form_fields  (id, workflow_id)   ON DELETE CASCADE
(workflow_id, workspace_id) → workflows   (id, workspace_id)
```

Elles rendent **structurellement impossible** une valeur qui répondrait, pour une card donnée, à
une question posée par un autre workflow. C'est le mécanisme de la décision 95, repris et non
réinventé : un trigger aurait rendu le même service, plus tard et moins sûrement.

**La première n'était pas possible en l'état, et la mesure l'a dit.** MESURÉ le 2026-08-05 :

```
create table sonde (card_id uuid, workflow_id uuid,
  foreign key (card_id, workflow_id) references public.cards (id, workflow_id));
ERROR:  there is no unique constraint matching given keys for referenced table "cards"
```

`cards` ne portait que `PRIMARY KEY (id)`. `CRM-036` ajoute donc `UNIQUE (id, workflow_id)` sur
`cards`, exactement comme `form_fields` porte `UNIQUE (id, workflow_id)` depuis `CRM-035` et
`workflow_steps` depuis `CRM-031`. **Cet ajout ne change aucun comportement** : `id` étant déjà
clé primaire, le couple était déjà unique ; il rend seulement la relation exprimable. MESURÉ après
l'ajout : une paire cohérente est acceptée, une paire croisant deux workflows est refusée en
`23503`, « Key (card_id, workflow_id)=(…) is not present in table "cards" ».

**La cascade est voulue dans les deux sens.** Supprimer une card emporte ses valeurs — une réponse
sans question posée n'est pas une donnée à conserver ; supprimer un champ emporte les siennes. Ce
second cas ne se produit pas depuis le produit : `form_fields` n'expose **aucune** suppression, et
l'archivage tient lieu de suppression (§2.7). La cascade protège la cohérence d'un geste
d'exploitation, pas d'un geste d'utilisateur.

### 6.4 La validation par type est un trigger, parce qu'un `CHECK` ne peut pas — mesuré

Le type qui gouverne une valeur est déclaré **sur une autre table**, `form_fields.type`. Un
`CHECK` ne peut donc pas l'atteindre. MESURÉ le 2026-08-05 :

```
create table sonde (… constraint c check (exists (select 1 from public.form_fields …)));
ERROR:  cannot use subquery in check constraint
```

La validation est donc un trigger `BEFORE INSERT OR UPDATE`, `SECURITY DEFINER` et `search_path`
vide : il doit lire `form_fields` **en entier**, et non ce que la RLS de l'appelant lui montre —
un champ invisible ne doit pas être un champ non validé.

MESURÉ contre PostgREST `v14.12` : un refus levé depuis un trigger est rendu **`400`**, que le
`SQLSTATE` soit `P0001` ou `22023`, et le `DETAIL` du `raise` apparaît dans la clé `details` de la
réponse JSON. Le refus porte donc `message = 'invalid_field_value'` — un jeton stable, comparable
par égalité, comme les cinq refus de `move_card` — et le `DETAIL` nomme la clé du champ et la forme
attendue.

### 6.5 Ce que chaque type accepte, et ce qui n'est pas vérifié

| Type | Forme `jsonb` acceptée | Vérification supplémentaire |
|---|---|---|
| `text`, `textarea`, `url`, `email`, `phone` | `string` | `url` : `^https?://` ; `email` : présence d'un `@` et d'un point dans le domaine. `phone` : **aucune**, les formats nationaux étant trop divers pour qu'un refus soit défendable |
| `number`, `money` | `number` | aucune. `money` ne vérifie pas la devise : elle est portée par `options.currency` du champ, non par la valeur |
| `date` | `string` convertible en `date` | la conversion elle-même |
| `datetime` | `string` convertible en `timestamptz` | la conversion elle-même |
| `select` | `string` | **la clé doit figurer dans `options.choices`** |
| `multiselect` | `array` de `string` | **chaque clé doit figurer dans `options.choices`** ; les doublons sont acceptés |
| `checkbox` | `boolean` | aucune |
| `user`, `contact` | `string` convertible en `uuid` | **aucune résolution** — voir ci-dessous |
| `file` | `string` | aucune : le chemin vise Storage, service distinct |

**`select` et `multiselect` closent le point ouvert n° 4 du §8.** Le §2.4 posait que la base ne
contraint pas la forme des entrées de `choices`, et renvoyait la vérification à « la validation de
`CRM-036`, ou pas du tout ». Elle est faite : une clé de choix inconnue est refusée. MESURÉ sur le
seed, les quatre clés du champ `source` sont `salon`, `recommandation`, `site`, `prospection` ; une
cinquième est refusée.

**`user` et `contact` ne sont pas résolus, et c'est nommé plutôt que tu.** Le §2.3 annonce que
« le résoudre appartient à `CRM-036` et à `CRM-060` » sans dire lequel fait quoi. `contact` vise
`contacts`, table qui n'existe pas (`CRM-060`) : sa résolution est impossible aujourd'hui.
Résoudre `user` seul rendrait la famille incohérente — deux types voisins, l'un opposable et
l'autre non — et **poserait une règle que nul document n'énonce** : un `user` doit-il être membre
du workspace, ou tout profil convient-il ? Les deux types valident donc la **forme** d'un `uuid`, et
rien de plus. Consigné en `docs/INCONSISTENCY_REPORT.md`, **INC-053**, arbitrage attendu.

### 6.6 « Renseigné » : la définition dont dépend la sixième vérification

Une ligne présente ne suffit pas. Une valeur est **renseignée** lorsqu'elle n'est **aucune** de :

- `'null'::jsonb` — la façon dont le produit exprime « vidé explicitement » (`docs/SCHEMA.md` §4) ;
- une chaîne vide, ou faite de seuls espaces ;
- un tableau vide.

Tout le reste est renseigné, y compris `false`, `0` et `"0"` : une case décochée est une réponse,
pas une absence de réponse. Confondre les deux rendrait une case à cocher impossible à satisfaire
par la négative.

Cette définition est portée par une fonction, `app.valeur_de_champ_est_vide(jsonb)`, et non par une
expression recopiée dans chaque appelant : la sixième vérification de `move_card` et le rendu de
`CRM-037` doivent en donner la **même** lecture, faute de quoi l'interface annoncerait passable une
transition que la garde refuse.

### 6.7 La sixième vérification de `move_card`, et l'union qu'elle contrôle

`CRM-034` a livré cinq vérifications sur six ; la sixième attendait cette unité (INC-047, et
`docs/SPEC-workflow-engine.md` §5.7). Elle est livrée ici, ce que la Definition of Done de
`CRM-036` demande mot pour mot — « union étape + transition », « `hidden` non exigé ».

**L'ensemble exigé** est l'union définie au §3.5 :

1. les champs portant une règle `required` sur l'**étape cible** ;
2. les champs désignés par `require_fields` de la **transition empruntée**.

**Ce qui n'en fait pas partie**, et chaque exclusion est une décision :

- un champ **sans règle** à l'étape cible. Le défaut du §3.1 est `visible`, non `required` : une
  absence de règle n'a jamais rien exigé ;
- un champ `hidden` à l'étape cible **par la règle de cette étape**. C'est la lecture littérale du
  §3.1 — `hidden` n'est pas `required` — et la Definition of Done la nomme ;
- un champ **archivé** (`archived_at` non nul), quelle que soit sa règle et quel que soit
  `require_fields`. Le §5 pose que l'archivage retire un champ des formulaires : exiger un champ
  qu'aucun formulaire n'affiche rendrait la transition impossible à satisfaire depuis le produit ;
- un identifiant de `require_fields` **que la jointure ne résout pas** — champ supprimé, ou
  appartenant à un autre workflow. Le §3.5 laissait le choix entre « ignorer » et « dénoncer ». Le
  choix est d'**ignorer**, et le motif est asymétrique : dénoncer bloquerait définitivement une
  transition pour une erreur de saisie d'administrateur, sans qu'aucun utilisateur ne puisse la
  corriger depuis le produit, alors qu'ignorer ne fait que ne pas exiger ce que personne ne peut
  renseigner. Aucune intégrité référentielle ne protège ce tableau (INC-033), et le comportement est
  **figé par une assertion** plutôt que laissé au hasard.

**En revanche, un champ `hidden` à l'étape cible ET désigné par `require_fields` est exigé.** Le
§3.5 dit « indépendamment de l'étape cible », et une arête déclarée par un administrateur est un
geste explicite, là où l'absence de règle est un défaut. Le cas est exercé par une assertion, sans
quoi cette prose serait la seule chose qui le tienne.

**Le refus.** `message = 'missing_required_fields'`, `SQLSTATE` `P0001`, donc HTTP `400` — MESURÉ,
comme les quatre autres refus `P0001` de la fonction. Le `DETAIL` porte **la liste des clés
manquantes**, séparées par `, ` et ordonnées par `position`, ce que `docs/SPEC-form-composer.md` §6
exigeait depuis `CRM-000` : « afin que le client puisse les mettre en évidence sans deviner ».

MESURÉ le 2026-08-05, deux écritures possibles et le choix entre elles :

| Écriture | Réponse PostgREST |
|---|---|
| `raise exception 'missing_required_fields: %', clés` | `{"code":"P0001","details":null,"message":"missing_required_fields: {budget,source}"}` |
| `raise … using detail = clés` | `{"code":"P0001","details":"budget, source","message":"missing_required_fields"}` |

La seconde est retenue. La première rend le `message` **incomparable par égalité** : il porterait
une liste variable, et chaque test devrait le découper pour le lire. Les cinq refus déjà livrés sont
des jetons stables ; le sixième le reste, et la donnée variable voyage dans le champ prévu pour elle.

**La vérification vient en dernier**, après les cinq autres. Une card invisible ne doit pas
apprendre par un refus quels champs son workflow exige : la discrétion du §5.3 de
`docs/SPEC-workflow-engine.md` prime.

### 6.8 Ce qui ne peut pas être contourné

- l'interface ne fait que **prévenir** : `CLAUDE.md` §10 l'exige de toute règle d'accès, et la
  garde vit en base ;
- l'écriture directe d'une valeur passe par `card_field_values`, protégée par RLS **et** par le
  trigger de validation, qui s'applique au propriétaire de la table comme à quiconque ;
- le contrôle des champs requis s'exécute **dans la même transaction** que le déplacement : aucune
  fenêtre ne s'ouvre entre le contrôle et l'écriture.

### 6.9 Autorisations

| Geste | Qui |
|---|---|
| Lire une valeur | Qui a le droit de **lire la card** — `app.can_read_card(card_id)` |
| Écrire une valeur, la modifier | Qui a le droit d'**écrire sur le channel** de la card |
| Supprimer une valeur | **Personne.** Vider un champ, c'est écrire `'null'::jsonb` (§6.6) |

C'est exactement la ligne `card_field_values` du tableau de `docs/SPEC-permissions-rls.md` §4 —
« Lecture de la card / Écriture sur le channel ».

`app.can_read_card` existe depuis `CRM-040`, et son commentaire nomme `card_field_values` parmi ses
appelants prévus. Son symétrique en écriture n'existait pas : `CRM-036` livre
**`app.can_write_card(uuid)`**, de même forme, parce qu'une table fille ne dispose que d'un
`card_id` et qu'aucune politique ne peut atteindre le channel sans cette jointure. Ce n'est pas un
élargissement de périmètre : c'est le seul moyen d'écrire la règle que le §4 prescrit. Elle est
inscrite dans `docs/SPEC-permissions-rls.md` §3 dans le même changement.

**Aucun privilège `DELETE`, aucune politique `for delete`** : le refus est double, comme pour
`form_fields` (décision 96). La dégradation du harnais accorde le privilège pour constater que la
politique tient encore la seconde barrière.

**Le `RETURNING` d'un `INSERT` est soumis à la politique `SELECT`** : la politique de lecture
appelle `app.can_read_card`, qui lit `cards` — une **autre** table, déjà écrite. Le défaut de la
décision 107 ne se reproduit donc pas ici ; il se reproduirait si la politique relisait
`card_field_values`, ce qu'elle ne fait pas.

### 6.10 Contrat d'API attendu, à mesurer

Dix-huit lignes, écrites **avant** le code pour être mesurées et non supposées. Jetons réels des
trois profils seedés, appels `POST`, `PATCH` et `GET` sur `/rest/v1/card_field_values`, et
`POST /rest/v1/rpc/move_card`.

| # | Appelant | Geste | Attendu |
|---|---|---|---|
| a | anonyme | lecture | `200`, `[]` — refus n° 11 |
| b | anonyme | écriture | refus, aucune ligne créée |
| c | `admin` | lecture des valeurs seedées | `200`, les valeurs de son workspace |
| d | `viewer` | écriture d'une valeur sur une card qu'il voit | `403` — droit d'écriture requis |
| e | `viewer` | lecture d'une valeur d'une card qu'il voit | `200`, la valeur |
| f | `viewer` | lecture d'une valeur d'une card d'un channel que le seed lui ferme | `200`, `[]` — refus n° 4 |
| g | `bizdev` | écriture d'une valeur sur une card d'un channel où il est rétrogradé en lecture | `403` |
| h | `admin` | écriture d'une valeur de type conforme | `201` |
| i | `admin` | `money` recevant une chaîne | `400`, `invalid_field_value` |
| j | `admin` | `checkbox` recevant une chaîne | `400`, `invalid_field_value` |
| k | `admin` | `select` recevant une clé absente de `choices` | `400`, `invalid_field_value` |
| l | `admin` | `date` recevant une chaîne non convertible | `400`, `invalid_field_value` |
| m | `admin` | `url` recevant `javascript:…` | `400`, `invalid_field_value` |
| n | `admin` | `'null'::jsonb` sur n'importe quel type | `201` — vidé explicitement |
| o | `admin` | valeur croisant card et champ de deux workflows | `400`, `23503` |
| p | `admin` | `DELETE` d'une valeur | refus |
| q | `admin` | `move_card` vers une étape dont un champ `required` est vide | `400`, `missing_required_fields`, `details` nommant la clé |
| r | `admin` | même appel, la valeur ayant été renseignée | `200` |

Chaque refus **relit la ligne** pour la constater inchangée : une réponse d'erreur ne prouve pas
qu'aucune écriture n'a eu lieu.

### 6.11 Ce que le seed livre

Le seed pose des valeurs sur **cinq cards**, choisies pour que chaque règle soit exercée par une
donnée permanente et non seulement par une suite de tests :

| Card | Valeurs | Ce que la donnée démontre |
|---|---|---|
| `c1` « Refonte du site vitrine », étape *relance* | `source`, et `budget` à `'null'::jsonb` | **Une ligne présente n'est pas une valeur renseignée** (§6.6). La transition vers *négociation* est refusée, et la carte reste le cas de refus permanent du produit |
| `c2` « Migration ERP Sogexia », étape *relance* | `source`, `budget` | Le cas symétrique : même étape, même transition, **acceptée**. Sans cette paire, un refus ne prouverait pas que la règle discrimine |
| `c3` « Audit sécurité applicative », étape *prospection* | `source`, `budget`, `budget-previsionnel` | Un champ `hidden` à l'étape courante **portant une valeur** (§4, section repliée), et une valeur portée par un champ **archivé** (§5) |
| `c4` « Refonte intranet Ville de Lyon », étape *négociation* | `budget`, `lien-proposition` | La liste **à plusieurs clés** : la transition vers *signature* manque `date-signature-prevue` et `decideur-identifie` |
| `c6` « Piste entrante à qualifier », étape *prospection* | `motif-perte`, `source` | Le parcours « Marquer perdu » reste franchissable : l'étape *perdu* exige `motif-perte` |
| `c7` « Formation Data & IA », étape *signature* | `budget`, `date-signature-prevue`, `decideur-identifie` | Les trois exigences de son étape courante sont satisfaites — et la transition suivante en exige une **quatrième**, par `require_fields` |

**`require_fields` cesse d'être vide, et le motif de son vide a disparu.** Le §5.9 de
`docs/SPEC-workflow-engine.md` le justifiait ainsi : « la vérification qui le lirait n'est pas
livrée ». Elle l'est. La transition *signature → réalisation* exige donc `lien-proposition` :
c'est la seule donnée du seed qui exerce le **second membre** de l'union du §3.5, et sans elle
cette moitié de la règle ne serait démontrée par aucune donnée.

Sept types sur quinze sont exercés par le seed — `money`, `select`, `date`, `textarea`, `checkbox`,
`url`, `number` —, ce sont ceux que `CRM-035` a déclarés. Les huit autres sont éprouvés par la
suite pgTAP sur des champs sondes, créés puis détruits : ajouter des champs au seed pour eux
rouvrirait `CRM-035`.

### 6.12 Ce que `CRM-036` ne livre pas, et qui est nommé

- **aucun écran.** Le rendu du formulaire, la section repliée, la mention « requis pour passer à »
  et le défilement jusqu'au premier champ manquant sont `CRM-037` (§4) ;
- **aucune résolution de `user`, `contact` ni `file`** — §6.5, INC-053 ;
- **aucune trace** : une valeur écrasée ne laisse rien derrière elle (`CRM-044`) ;
- **aucune condition inter-champs** : point ouvert n° 1 du §8, inchangé ;
- **aucune copie des valeurs** lorsqu'un workflow est copié vers un track. La copie ne porte déjà
  pas les champs (INC-037) ; elle ne portera pas davantage leurs réponses, qui appartiennent à des
  cards et non à un workflow.

## 7. Vérification exigée

### 7.1 Preuves attendues de `CRM-035`

| Niveau | Preuves attendues |
|---|---|
| pgTAP | Forme des deux tables et de leurs contraintes ; `type` hors liste refusé ; `visibility` hors liste refusée ; `select` sans `choices` refusé ; `money` sans `currency` refusé ; `key` dupliquée dans un workflow refusée, acceptée dans un autre ; règle croisant deux workflows refusée **dans les deux sens** ; suppression d'une étape emportant ses règles ; `position` attribuée dans la portée du workflow ; RLS active et politiques présentes ; aucun privilège `DELETE` sur `form_fields` ; conformité du seed |
| API | Les vingt et une lignes du contrat du §2.8, avec les jetons réels des trois profils seedés, chaque refus **relisant la ligne** pour la constater inchangée |
| E2E | **Aucune** : cette unité ne livre aucun écran (INC-021). L'absence est nommée, elle n'est pas contournée par une preuve de substitution |
| Visuel | **Aucune**, pour la même raison |

### 7.2 Preuves attendues de `CRM-036`

| Niveau | Preuves attendues |
|---|---|
| pgTAP | Forme de la table, de ses trois clés composites et de l'unicité ajoutée à `cards` ; les quinze types validés **dans les deux sens** ; `'null'::jsonb` accepté partout ; `select` hors `choices` refusé ; champ `required` manquant → transition refusée, avec la liste des clés ; champ `hidden` non exigé même si vide ; **union** étape + transition ; champ archivé non exigé ; identifiant non résolu de `require_fields` ignoré ; règle ajoutée après coup n'invalide pas une card déjà en place ; RLS active, politiques présentes, aucun privilège `DELETE` ; conformité du seed |
| API | Les dix-huit lignes du contrat du §6.10, avec les jetons réels des trois profils seedés, chaque refus **relisant la ligne** pour la constater inchangée. Preuves de refus n° 4 et n° 11 de `docs/SPEC-permissions-rls.md` §7 |
| E2E | **Aucune** : cette unité ne livre aucun écran (INC-021). L'absence est nommée, elle n'est pas contournée par une preuve de substitution |
| Visuel | **Aucune**, pour la même raison |

### 7.3 Preuves attendues de `CRM-037`

| Niveau | Preuves attendues |
|---|---|
| E2E | Transition bloquée avec message compréhensible, saisie du champ, transition réussie ; champ d'une autre étape visible en lecture seule |
| Visuel | Formulaire à chaque étape, état d'erreur, section repliée, rendu sur mobile |

## 8. Points ouverts

1. **Conditions inter-champs** (« afficher *Budget* seulement si *Type de projet* = sponsoring »)
   ne sont pas couvertes : seule la conditionnalité par étape est spécifiée. À arbitrer si le
   besoin se confirme.
2. **Champs calculés** (score, montant pondéré affiché comme un champ) non couverts en v1 ; le
   montant pondéré est calculé à la lecture, pas stocké.
3. **La copie d'un workflow vers un track ne copie pas ses champs.** Le §2.1 affirme pourtant que
   le formulaire suit le workflow, et `CRM-032` avait la copie des champs dans sa Definition of
   Done. Depuis `CRM-035`, la conséquence est **réelle** : la copie posée par le seed porte zéro
   champ là où sa source en porte sept. INC-037, trois options d'arbitrage, à trancher par le
   responsable. Le comportement reste inchangé tant qu'il ne l'a pas été.
4. ~~**La forme des entrées de `choices` n'est pas contrainte par la base** (§2.4).~~ **CLOS par
   `CRM-036`** : la base ne la contraint toujours pas — un `CHECK` ne peut porter aucune
   sous-requête —, mais la **valeur** d'un `select` ou d'un `multiselect` est désormais refusée
   lorsque sa clé ne figure pas dans `options.choices` (§6.5). Le risque nommé au §2.4 — une clé de
   choix inconnue arrivant jusqu'à l'affichage — est éteint du côté qui compte, celui des réponses.
5. **`user` et `contact` ne sont pas résolus** (§6.5) : leur valeur est validée comme un `uuid` et
   rien de plus. INC-053, arbitrage attendu.
