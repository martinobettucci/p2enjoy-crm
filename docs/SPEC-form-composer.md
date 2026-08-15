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
aucune clé étrangère n'est possible, exactement comme c'était le cas pour l'ancien tableau
`require_fields` avant sa correction par `CRM-018` (INC-033).
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

### 2.10 Frontières historiques de `CRM-035`, refermées par les unités suivantes

- **Copie des champs vers un track.** `CRM-035` n'avait pas modifié la fonction plus ancienne,
  faute d'arbitrage sur INC-037. La décision 293 tranche désormais la frontière : `CRM-018` copie
  et remappe le formulaire complet — champs, règles et exigences — dans le même geste que le
  workflow. Une copie sans formulaire n'est plus un état produit conforme.
- **À la livraison de `CRM-035`, `require_fields` reste vide dans le seed.** La colonne pouvait
  alors désigner des champs réels, mais aucune garde ne la lisait : une donnée de démonstration que
  rien n'exerce est une décoration, pas une preuve. `CRM-036` a ensuite livré la garde et
  `CRM-018` remplace désormais ce tableau par une liaison.
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

Une transition peut exiger des champs supplémentaires par
`workflow_transition_required_fields (transition_id, field_id)`, indépendamment de l'étape cible.
L'ensemble effectivement contrôlé est l'union des champs `required` de l'étape cible et des champs
liés à la transition empruntée.

Les deux clés étrangères suppriment les identifiants morts, avec `on delete cascade`, et un trigger
refuse en `23514` toute liaison vers le champ d'un autre workflow. C'est la correction structurelle
de l'ancien tableau `require_fields` décidée pour INC-033 ; son contrat complet est dans
`docs/SPEC-transition-required-fields.md`.

## 4. Rendu — `CRM-037`

Ce chapitre a été **réécrit avant la première ligne de code de `CRM-037`**, le 2026-08-05, et
**après mesure** du seed réellement appliqué sur la pile de développement : les sept champs, les
dix-sept règles, les neuf cards et les quatorze valeurs citées en exemple ci-dessous ont été lues
en base, elles ne sont pas inventées. Il tenait auparavant en cinq lignes, qui disaient *ce que*
l'écran montre sans jamais dire *comment* il le compose ni *ce qu'il faut prouver* de lui.

Les cinq règles d'origine sont conservées mot pour mot — elles ouvrent les §4.2 à §4.5 — et rien
n'y est retiré.

### 4.1 La composition, et pourquoi elle ne part jamais des règles

Le §3.1 le pose déjà : « le formulaire d'une étape ne se lit **jamais** en listant les règles de
cette étape, mais en listant les **champs du workflow** puis en appliquant les règles trouvées ».
Le rendu en tire un algorithme, et un seul :

1. lire les champs du workflow de la card, **ordonnés par `position`** ;
2. pour chacun, chercher la règle du couple (champ, étape courante) ; **son absence vaut
   `visible`** (§3.1) ;
3. lire les valeurs de la card, indexées par champ ;
4. répartir chaque champ dans **exactement une** des trois destinations du §4.2.

MESURÉ sur le seed, workflow par défaut, étape `Prospection` : six champs actifs, cinq règles pour
cette étape, donc **un champ sans règle** — `decideur-identifie` — qui doit apparaître comme
`visible`. Une lecture par les règles seules le perdrait, et l'écran serait faux sans qu'aucune
erreur ne le signale.

### 4.2 Les trois destinations, et la seule qui ne soit pas dans le §3.1

> Les champs sont ordonnés par `position`.

> Un champ `hidden` à l'étape courante **mais portant une valeur** est affiché dans une section
> repliée « Informations d'autres étapes », en lecture seule. Masquer purement et simplement une
> donnée saisie serait une perte d'information silencieuse.

| Destination | Qui y va |
|---|---|
| **Formulaire de l'étape** | champ actif dont la visibilité résolue est `visible` ou `required` |
| **Section repliée « Informations d'autres étapes »** | champ dont la visibilité résolue est `hidden` **et** qui porte une valeur renseignée (§4.3) ; **et** champ **archivé** portant une valeur renseignée |
| **Rien du tout** | champ `hidden` sans valeur ; champ archivé sans valeur |

Le champ **archivé** est la seule addition à la lettre du §4 d'origine, et elle ne vient pas de
nulle part : le §5 pose que l'archivage « retire un champ des formulaires **sans supprimer les
valeurs déjà saisies**, qui restent consultables dans la section repliée ». Le §5 nomme donc déjà
cette destination ; le §4 ne la nommait pas. Elle est écrite ici plutôt que laissée à
l'interprétation du composant.

MESURÉ sur le seed : la card `…0000c6` (« Piste entrante à qualifier ») est à `Prospection`, où
`motif-perte` est `hidden`, et elle **porte** une valeur pour ce champ. La section repliée n'est
donc pas une hypothèse d'écran : le seed la remplit.

### 4.3 « Renseigné » : l'interface lit la même définition que la garde

Le §6.6 définit « renseigné » et le confie à `app.valeur_de_champ_est_vide(jsonb)`, en exigeant que
« la sixième vérification de `move_card` et le rendu de `CRM-037` [en] donnent la **même**
lecture, faute de quoi l'interface annoncerait passable une transition que la garde refuse ».

Cette exigence n'est pas prouvable par la lecture des deux codes : ils sont écrits dans deux
langages et vivent dans deux processus. Elle est donc rendue vérifiable par un **tableau de cas
partagé** :

- le tableau vit dans le code de l'interface, à côté du prédicat, et énumère les huit familles du
  §6.6 — `null` SQL, `'null'::jsonb`, chaîne vide, chaîne de blancs, tableau vide, et les contre-cas
  `false`, `0`, `"0"` — plus les valeurs ordinaires de chaque type, et depuis la décision 374 les
  blancs non-espaces qui séparaient les deux lectures : tabulation, saut de ligne, espace
  insécable `U+00A0` et cadratin `U+2003` ;
- le **test unitaire** de l'interface l'exerce contre le prédicat TypeScript ;
- une **preuve d'API** écrit chacune de ces valeurs dans une vraie ligne `card_field_values`, par
  la vraie route, puis demande à `move_card` une transition qui **exige** ce champ, et relève si le
  refus `missing_required_fields` tombe.

Les deux lectures sont ainsi comparées **sur les mêmes valeurs**, chacune par son propre chemin.
Une divergence future rend la preuve d'API rouge, quel que soit celui des deux côtés qui a bougé.

### 4.4 Ce qu'un champ exigé affiche, et pourquoi il le dit

> Un champ `required` porte un astérisque et la mention explicite « requis pour passer à
> <étape> » : l'utilisateur comprend la raison de l'obligation.

La mention nomme l'étape **courante**, celle dont la règle exige le champ, et non une étape à
venir : le §3.4 pose qu'un champ `required` sur *E* est exigé « au moment où une card entre dans
*E* ». Pour une card **déjà** dans *E*, la mention explique donc ce qui a été — ou aurait dû être —
exigé à l'entrée, et ce que la garde exigera de nouveau à la prochaine entrée dans *E*.

Le §3.4 pose aussi que « les données déjà existantes ne sont jamais invalidées rétroactivement :
une card entrée dans *E* avant l'ajout d'une règle `required` y reste, et le champ manquant est
**signalé dans l'interface sans bloquer la lecture** ». Le rendu tient les deux : un champ exigé et
vide est mis en évidence, et rien de l'écran n'est retiré pour autant.

Les champs exigés par la **transition** (liaisons du §3.5) ne sont pas connus du rendu d'une
étape : ils dépendent de l'arête empruntée, donc d'un geste qui n'a pas encore eu lieu. Ils
apparaîtront lorsque l'interface proposera les transitions — `CRM-041`. L'écart est nommé au §4.7.

### 4.5 Erreurs, accessibilité et états

> Les erreurs sont affichées au niveau du champ, avec `role="alert"` et association
> `aria-describedby`.

> Lorsqu'une transition est refusée pour champs manquants, l'interface met en évidence les
> champs concernés et fait défiler jusqu'au premier.

Contrat vérifiable, aligné sur `docs/DESIGN_SYSTEM.md` §5.7 et §8 :

| Exigence | Ce qui la rend vérifiable |
|---|---|
| Libellé lié au champ | `label` porteur d'un `for` résolvant vers l'`id` du contrôle |
| Astérisque | marque visuelle **doublée** d'un texte lisible par lecteur d'écran ; jamais l'astérisque seul |
| Message d'exigence | élément portant `role="alert"`, cité par l'`aria-describedby` du contrôle |
| Champ exigé et vide | `aria-invalid="true"` sur le contrôle |
| Section repliée | `details`/`summary` natifs, ouvrables au clavier, contenu en lecture seule |
| Contrôle indisponible | reste **lisible** et **explique pourquoi** (`docs/DESIGN_SYSTEM.md` §8) |

Les quatre états systématiques du §5.8 du design system sont traités par l'écran hôte : chargement
(squelettes), vide (« aucun champ pour cette étape »), erreur (message et reprise), card
introuvable ou non consentie (état explicite, jamais une page blanche).

Le **défilement jusqu'au premier champ concerné** appartient au geste de transition, qui n'existe
pas encore : il est nommé au §4.7 plutôt qu'implémenté sans rien à quoi le rattacher.

### 4.6 L'écran hôte, et pourquoi c'est une route

Le formulaire est la colonne gauche du **détail de card** (`docs/DESIGN_SYSTEM.md` §5.3). Il lui
faut donc une adresse. `CRM-037` livre la route `/tracks/:slugTrack/:slugChannel/cards/:idCard`,
et **rien d'autre de cet écran** : la timeline (`CRM-044`), les commentaires (`CRM-043`) et les
champs d'en-tête de la card (`CRM-040`) restent dus par leurs unités.

C'est le procédé de `CRM-021`, qui a livré la route d'un track parce que la barre d'onglets n'avait
aucun hôte. Le motif est le même, et il est écrit plutôt que supposé : un composant qu'aucune
adresse n'atteint ne peut être ni regardé, ni éprouvé dans le navigateur, ce que `CLAUDE.md` §16
exige de toute modification d'interface.

La card est désignée par son **identifiant** et non par un slug : `docs/SPEC-cards.md` ne lui en
donne aucun, et son `email_local_part` est délibérément non devinable — en faire une adresse
publique le divulguerait.

### 4.6 bis Ce que la coquille montre autour du formulaire

Ce paragraphe est écrit **après** la première livraison du §4.6, et **avant** la ligne de code qui
le tient : la route livrée le 2026-08-05 laissait la barre d'onglets vide, et rien dans ce chapitre
ne disait ce qu'elle devait montrer. L'écart a été relevé **sur une capture**, consigné comme limite
de `CRM-037` — « la barre d'onglets reste vide sur la route d'une card […] à reprendre au prochain
passage » —, et c'est ce passage.

**La règle, et d'où elle vient.** `docs/DESIGN_SYSTEM.md` §4 pose : « Onglets : les channels du
track courant. » La route du §4.6 porte un track courant — son premier segment est un `slugTrack`,
et le second un `slugChannel`. La coquille montre donc, autour du formulaire, **exactement** ce
qu'elle montre sur la route d'un track :

| Élément | Sur `/tracks/:slugTrack/:slugChannel` | Sur `/tracks/:slugTrack/:slugChannel/cards/:idCard` |
|---|---|---|
| Barre latérale | tracks du workspace | identique |
| Titre de route | nom du track | **titre de la card** (déjà livré) |
| Barre d'onglets | channels du track porteur, onglet courant marqué | **identique** |

Les channels sont lus par le **même chargeur** que la route d'un track — `docs/SPEC-channels.md`
§5, requête filtrée côté serveur sur `track_id`, archivés exclus, ordonnés par `position` puis par
`name`. Un second chargeur qui lirait les mêmes lignes autrement finirait par en diverger.

**L'onglet courant n'a pas besoin d'être calculé.** Le patron du §5.3 de `docs/SPEC-channels.md`
est une navigation par `NavLink` vers `/tracks/:slugTrack/:slugChannel`, dont l'état actif se
résout par **préfixe de segments** : l'adresse d'une card commence par celle de son channel, donc
l'onglet du channel porteur est actif de lui-même. Aucune règle particulière n'est ajoutée pour la
route de card — en ajouter une créerait une seconde définition de « onglet courant ».

**Ce que la coquille fait d'un échec.** Le chargement des channels rejoint les deux chargements
déjà présents — contexte d'espace de travail, tracks — dans la décision de la zone principale : un
refus l'emporte sur une panne, une panne offre une reprise, et la reprise les relance **tous**.
Un échec de channels remplace donc le formulaire par l'état d'erreur, plutôt que d'être avalé par
une barre d'onglets qui n'a la place ni de l'expliquer ni d'offrir une reprise. C'est la règle déjà
posée pour la route d'un track, et non une règle propre à cet écran.

**Ce que ce paragraphe ne dit pas, délibérément.** Il n'exige **aucun contrôle de cohérence** entre
la card et le couple `(slugTrack, slugChannel)` de l'adresse : la card est résolue par son seul
identifiant (§4.6), et rien ne vérifie qu'elle appartient au channel nommé. Une adresse dont le
track et le channel seraient étrangers à la card affiche donc le formulaire de la card et les
onglets de ce track. Le fait est réel, il n'est pas tranché ici, et il est porté par **INC-065**.

**État attendu lorsque rien n'est consenti.** L'appelant étant anonyme (INC-021), la résolution du
track rend zéro ligne, les channels ne sont pas demandés, et la barre affiche son état vide — le
même écran qu'avant ce paragraphe, pour une raison différente et **mesurable** : ce n'est plus une
barre qu'on n'a pas alimentée, c'est un refus du backend. La distinction se prouve en substituant
la réponse réseau (`docs/DESIGN_SYSTEM.md` §12.5), et le §7.3 l'exige.

### 4.7 Ce que `CRM-037` ne livre pas, et qui est nommé

- **~~Aucune écriture.~~ L'écriture appartient à `CRM-037`** — décision 334, INC-088. Le motif
  d'origine était l'absence de session (INC-021), **close depuis `CRM-009`** : la limite a survécu à
  son motif, sans que personne la réexamine. La Definition of Done de l'unité exige depuis l'origine
  « E2E (transition bloquée, **saisie**, transition réussie) » ; l'unité n'est donc pas élargie, elle
  est ramenée à son énoncé. `CRM-036` livre déjà `card_field_values`, ses politiques et sa
  validation : il ne manque que le chemin vers elles, et **aucune règle n'est créée ici**.
  *État réel tant que la reprise n'est pas livrée* : les contrôles restent **indisponibles**,
  lisibles, et l'écran **dit pourquoi** — ce que `docs/DESIGN_SYSTEM.md` §8 exige d'un état
  désactivé. Un formulaire où l'on saisirait sans pouvoir enregistrer serait un piège ; un
  formulaire qui n'affiche rien serait une perte d'information. Le bandeau « Consultation seule »
  disparaît avec la livraison, pas avec la décision.
- **Aucune transition.** Le menu des transitions déclarées et le glisser-déposer sont `CRM-041`.
  Sans eux, ni les champs exigés par les liaisons de transition (§4.4), ni la mise en évidence
  consécutive à un refus, ni le défilement jusqu'au premier champ (§4.5) n'ont de geste
  déclencheur.
- **Aucun parcours E2E « transition bloquée → saisie → transition réussie »**, que la Definition of
  Done de `CRM-037` exige : il suppose les deux points ci-dessus. INC-062, arbitrage attendu.
- **Aucune résolution de `user`, `contact` ni `file`** : le §6.5 ne les résout pas non plus
  (INC-053). Le rendu affiche leur valeur brute plutôt qu'un nom qu'il ne peut pas obtenir.

## 5. Édition du formulaire

Réservée aux administrateurs, dans l'éditeur de workflow. Une grille champ × étape permet de
régler la visibilité de chaque couple en un seul écran, plutôt que champ par champ.

L'archivage d'un champ (`archived_at`) le retire des formulaires **sans supprimer les valeurs
déjà saisies**, qui restent consultables dans la section repliée et dans l'export.

**Où cet écran est spécifié, et ce qui en est livré.** L'éditeur est porté par `CRM-076`, et
`docs/SPEC-workflow-engine.md` §7 bis le spécifie tranche par tranche. Le **§7 bis.10** couvre les
champs eux-mêmes — déclaration, libellé, aide, options, ordre, archivage et restauration — ainsi que
les deux colonnes que l'écran n'offre pas de modifier, `key` et `type`, avec la mesure qui motive
chacune. La **grille champ × étape** décrite ci-dessus est livrée par le **§7 bis.11**, quatrième
tranche : elle rend quatre états par case — l'absence de règle y est nommée « Par défaut » et se
distingue d'un `visible` explicite —, écarte les champs archivés de ses lignes puisqu'ils ne
figurent dans aucun formulaire, et règle une case par un `upsert` sur la clé primaire du §3.2. Les
**exigences de transition** du §3.5 et la prévisualisation des effets restent dues.

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
  où aucune clé étrangère n'est possible — même propriété du type que l'ancien `require_fields`
  sur un `uuid[]` (INC-033, corrigée pour ce dernier par `CRM-018`). Ce que `CRM-036` valide est la
  **forme**, pas l'existence de la cible (§6.5) ;
- elle n'a **aucune histoire**. Une valeur écrasée est perdue : la trace des modifications relève
  de `card_events` (`CRM-044`), qui n'existe pas.

### 6.2 Modèle — `card_field_values`

| Colonne | Type | Contraintes |
|---|---|---|
| `card_id` | `uuid` | PK composite ; clé étrangère **composite** avec `workflow_id` |
| `field_id` | `uuid` | PK composite ; clé étrangère **composite** avec `workflow_id` |
| `workflow_id` | `uuid` | non nul ; le workflow **commun** à la card et au champ — charnière des deux clés composites du §6.3 |
| `workspace_id` | `uuid` | non nul, dénormalisé pour la RLS ; sa véracité est garantie par une troisième clé composite |
| `value` | `jsonb` | **nullable** ; SQL `NULL` et `'null'::jsonb` signifient **explicitement vide** (§6.6) |
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

- SQL `NULL`, ou `'null'::jsonb` — les deux façons dont le produit exprime « vidé explicitement ».
  **La colonne est nullable, et une mesure l'a imposé** : PostgREST convertit un `null` JSON en SQL
  `NULL` et ne sait produire `'null'::jsonb` par aucune écriture, si bien qu'une contrainte
  `NOT NULL` rendait un champ `money` impossible à vider. INC-054, décision 133 ;
- une chaîne vide, ou faite de seuls **blancs** ;
- un tableau vide.

Tout le reste est renseigné, y compris `false`, `0` et `"0"` : une case décochée est une réponse,
pas une absence de réponse. Confondre les deux rendrait une case à cocher impossible à satisfaire
par la négative.

Cette définition est portée par une fonction, `app.valeur_de_champ_est_vide(jsonb)`, et non par une
expression recopiée dans chaque appelant : la sixième vérification de `move_card` et le rendu de
`CRM-037` doivent en donner la **même** lecture, faute de quoi l'interface annoncerait passable une
transition que la garde refuse.

**« Blancs » veut dire Unicode, et ce mot a coûté un défaut avant d'être arbitré.** Ce paragraphe a
d'abord écrit « faite de seuls **espaces** », et la fonction employait `btrim(valeur #>> '{}')`, qui
à un seul argument ne retire que `U+0020`. MESURÉ contre la base réelle, par la vraie route et le
vrai refus de `move_card` : une valeur réduite à `"\t"` ou `"\n"` était **renseignée** et satisfaisait
un champ `required`. Le prédicat TypeScript, écrit avec `trim()`, disait l'inverse — exactement la
divergence que le §4.3 existe pour interdire. La décision **165** avait alors corrigé le côté
TypeScript en **reproduisant `btrim` fidèlement**, faute d'arbitrage sur la règle elle-même
(INC-052).

L'arbitrage est rendu par la décision **367** (lot G) et mis en œuvre par la décision **374** : la
règle est **élargie aux blancs Unicode**, des deux côtés dans le même changement. L'ensemble retenu
est exactement celui de `String.prototype.trim()` — `U+0009`, `U+000A`, `U+000B`, `U+000C`, `U+000D`,
`U+0020`, `U+00A0`, `U+1680`, `U+2000` à `U+200A`, `U+2028`, `U+2029`, `U+202F`, `U+205F`, `U+3000`,
`U+FEFF` — et il est porté **une seule fois** par `app.btrim_blancs(text)`, qu'appellent
`app.valeur_de_champ_est_vide` et `move_card`. Le motif du choix est la convergence : cet ensemble
étant déjà celui du navigateur, le prédicat de l'interface redevient `trim()` et **ne peut plus
diverger par une réimplémentation**. La classe est énumérée en toutes lettres plutôt qu'écrite `\s`
ou `[[:space:]]`, qui dépendent du `ctype` de l'instance.

### 6.7 La sixième vérification de `move_card`, et l'union qu'elle contrôle

`CRM-034` a livré cinq vérifications sur six ; la sixième attendait cette unité (INC-047, et
`docs/SPEC-workflow-engine.md` §5.7). Elle est livrée ici, ce que la Definition of Done de
`CRM-036` demande mot pour mot — « union étape + transition », « `hidden` non exigé ».

**L'ensemble exigé** est l'union définie au §3.5 :

1. les champs portant une règle `required` sur l'**étape cible** ;
2. les champs liés à la **transition empruntée** dans
   `workflow_transition_required_fields`.

**Ce qui n'en fait pas partie**, et chaque exclusion est une décision :

- un champ **sans règle** à l'étape cible. Le défaut du §3.1 est `visible`, non `required` : une
  absence de règle n'a jamais rien exigé ;
- un champ `hidden` à l'étape cible **par la règle de cette étape**. C'est la lecture littérale du
  §3.1 — `hidden` n'est pas `required` — et la Definition of Done la nomme ;
- un champ **archivé** (`archived_at` non nul), quelle que soit sa règle et même s'il est lié à la
  transition. Le §5 pose que l'archivage retire un champ des formulaires : exiger un champ qu'aucun
  formulaire n'affiche rendrait la transition impossible à satisfaire depuis le produit.

Un identifiant mort ou le champ d'un autre workflow ne peut plus atteindre cette lecture : les
deux clés étrangères et le trigger de cohérence le refusent à l'écriture. L'ancien comportement de
`CRM-036`, qui ignorait ces anomalies du tableau faute d'intégrité possible, reste historique mais
n'est plus un état admissible après `CRM-018`.

**En revanche, un champ `hidden` à l'étape cible ET lié à la transition est exigé.** Le
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
| o | `admin` | valeur croisant card et champ de deux workflows | `409`, `23503` — **corrigé après mesure** : la table du §4.4 de `docs/SPEC-workflow-engine.md` range une violation de clé étrangère en conflit, non en requête invalide |
| p | `admin` | `DELETE` d'une valeur | `403` — **corrigé après mesure** : un rôle **authentifié** privé du privilège n'est pas un appelant sans rôle, même correction qu'au §2.8 de `CRM-035` |
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
| `c7` « Formation Data & IA », étape *signature* | `budget`, `date-signature-prevue`, `decideur-identifie` | Les trois exigences de son étape courante sont satisfaites — et la transition suivante en exige une **quatrième**, par sa liaison à `lien-proposition` |

**L'ancien `require_fields` a cessé d'être vide avec `CRM-036`, et son motif a disparu.** Le §5.9 de
`docs/SPEC-workflow-engine.md` le justifiait ainsi : « la vérification qui le lirait n'est pas
livrée ». Elle l'est ; `CRM-018` porte désormais la même exigence dans une liaison. La transition
*signature → réalisation* exige donc `lien-proposition` :
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
| pgTAP | Forme de la table, de ses trois clés composites et de l'unicité ajoutée à `cards` ; les quinze types validés **dans les deux sens** ; `'null'::jsonb` accepté partout ; `select` hors `choices` refusé ; champ `required` manquant → transition refusée, avec la liste des clés ; champ `hidden` non exigé même si vide ; **union** étape + transition ; champ archivé non exigé ; règle ajoutée après coup n'invalide pas une card déjà en place ; RLS active, politiques présentes, aucun privilège `DELETE` ; conformité du seed. La preuve historique d'identifiant non résolu ignoré est remplacée par les refus structurels de `CRM-018` |
| API | Les dix-huit lignes du contrat du §6.10, avec les jetons réels des trois profils seedés, chaque refus **relisant la ligne** pour la constater inchangée. Preuves de refus n° 4 et n° 11 de `docs/SPEC-permissions-rls.md` §7 |
| E2E | **Aucune** : cette unité ne livre aucun écran (INC-021). L'absence est nommée, elle n'est pas contournée par une preuve de substitution |
| Visuel | **Aucune**, pour la même raison |

### 7.3 Preuves attendues de `CRM-037`

Tableau d'origine, conservé :

| Niveau | Preuves attendues |
|---|---|
| E2E | Transition bloquée avec message compréhensible, saisie du champ, transition réussie ; champ d'une autre étape visible en lecture seule |
| Visuel | Formulaire à chaque étape, état d'erreur, section repliée, rendu sur mobile |

**Ce que ce tableau suppose, et qui n'existe pas.** « Transition bloquée », « saisie » et
« transition réussie » sont trois gestes d'un utilisateur **connecté** devant un contrôle de
transition. Le premier manque par INC-021, le second et le troisième par `CRM-041`, ordonnée
**après** cette unité. La première ligne n'est donc pas atteignable, et le constat est porté par
**INC-062** plutôt que contourné.

Ce qui est atteignable, et exigé de `CRM-037` :

| Niveau | Preuves attendues |
|---|---|
| Unitaire | La composition du §4.1 sur les quatre destinations du §4.2, l'absence de règle valant `visible`, l'ordre par `position`, le champ archivé porteur d'une valeur, le prédicat « renseigné » du §4.3 sur le tableau de cas partagé, et le rendu du composant réel : astérisque, mention « requis pour passer à », `role="alert"`, `aria-describedby`, `aria-invalid`, section repliée |
| API | Le tableau de cas du §4.3 écrit dans de vraies lignes `card_field_values` par la vraie route, chaque valeur confrontée au refus `missing_required_fields` de `move_card` : la lecture SQL de « renseigné » et la lecture TypeScript sont comparées sur les mêmes valeurs |
| E2E | La route du §4.6 atteinte par un appelant **anonyme** : elle rend l'état « card introuvable », qui est le refus réel du backend ; puis, **la réponse réseau substituée** — procédé endossé par `docs/DESIGN_SYSTEM.md` §12.5 —, le formulaire chargé, sa section repliée ouverte au clavier, son état d'exigence, et les quatre paliers du §7 du design system |
| E2E (§4.6 bis) | La route du §4.6 demande réellement les channels de son track porteur — requête filtrée sur `track_id`, archivés exclus — et, la réponse substituée, la barre d'onglets porte ces channels avec l'onglet du channel de l'adresse marqué `aria-current="page"` ; anonyme, elle affiche l'état vide, qui est le refus réel du backend |
| Visuel | Captures des états ci-dessus, produites depuis l'application réellement construite et servie, **observées** avant livraison |

## 8. Points ouverts

1. **Conditions inter-champs** (« afficher *Budget* seulement si *Type de projet* = sponsoring »)
   ne sont pas couvertes : seule la conditionnalité par étape est spécifiée. À arbitrer si le
   besoin se confirme.
2. **Champs calculés** (score, montant pondéré affiché comme un champ) non couverts en v1 ; le
   montant pondéré est calculé à la lecture, pas stocké.
3. ~~**La copie d'un workflow vers un track ne copie pas ses champs.**~~ **ARBITRÉ par la décision
   293, à livrer par `CRM-018`** : le formulaire, ses règles et ses exigences sont tous remappés.
   La mesure historique « zéro champ dérivé » reste la contre-preuve que les nouvelles suites
   doivent renverser.
4. ~~**La forme des entrées de `choices` n'est pas contrainte par la base** (§2.4).~~ **CLOS par
   `CRM-036`** : la base ne la contraint toujours pas — un `CHECK` ne peut porter aucune
   sous-requête —, mais la **valeur** d'un `select` ou d'un `multiselect` est désormais refusée
   lorsque sa clé ne figure pas dans `options.choices` (§6.5). Le risque nommé au §2.4 — une clé de
   choix inconnue arrivant jusqu'à l'affichage — est éteint du côté qui compte, celui des réponses.
5. **`user` et `contact` exigent une vraie cible** (§6.5) : la décision 295 impose dès la reprise
   de `CRM-036` qu'un `user` soit un membre actif du workspace. `contact` est refusé explicitement
   jusqu'à la table de `CRM-060`, puis devra viser un contact du même workspace. Aucun UUID opaque
   n'est accepté entre-temps.
