# Spécification — Form composer (champs conditionnels)

Unités de backlog : `CRM-035` à `CRM-037` (voir `docs/BACKLOG.md`).
Documents liés : `docs/SCHEMA.md` §4, `docs/SPEC-workflow-engine.md` §3 (étapes) et §5
(`move_card`), `docs/SPEC-permissions-rls.md` §4 et §7, `docs/SPEC-seed.md` §2,
`docs/DESIGN_SYSTEM.md` §5.7.

Les §2 et §3 ont été **réécrits après mesure** pendant `CRM-035`, sur la pile réelle : sondes
créées puis détruites dans la base du seed, `SQLSTATE` relevés à la main, contrat d'API écrit avant
le code pour être mesuré et non supposé. Ce qu'ils énoncent est ce que la base tient, ni plus ni
moins ; ce qu'elle ne tient pas est nommé au §2.4 et au §2.10.

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
`CRM-036` et à `CRM-060`.

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
autre workflow y survivrait sans que rien ne le signale. C'est `move_card` (`CRM-034`) qui devra
ignorer, ou dénoncer, un identifiant qu'elle ne résout pas.

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

## 6. Validation côté backend

La validation vit dans `move_card` (voir `docs/SPEC-workflow-engine.md` §5). Elle ne peut pas
être contournée :

- l'interface ne fait que prévenir ;
- l'écriture directe d'une valeur de champ passe par `card_field_values`, protégée par RLS ;
- le contrôle des champs requis est exécuté dans la même transaction que le déplacement.

Le message d'erreur retourne **la liste des clés manquantes**, afin que le client puisse les
mettre en évidence sans deviner.

## 7. Vérification exigée

### 7.1 Preuves attendues de `CRM-035`

| Niveau | Preuves attendues |
|---|---|
| pgTAP | Forme des deux tables et de leurs contraintes ; `type` hors liste refusé ; `visibility` hors liste refusée ; `select` sans `choices` refusé ; `money` sans `currency` refusé ; `key` dupliquée dans un workflow refusée, acceptée dans un autre ; règle croisant deux workflows refusée **dans les deux sens** ; suppression d'une étape emportant ses règles ; `position` attribuée dans la portée du workflow ; RLS active et politiques présentes ; aucun privilège `DELETE` sur `form_fields` ; conformité du seed |
| API | Les vingt et une lignes du contrat du §2.8, avec les jetons réels des trois profils seedés, chaque refus **relisant la ligne** pour la constater inchangée |
| E2E | **Aucune** : cette unité ne livre aucun écran (INC-021). L'absence est nommée, elle n'est pas contournée par une preuve de substitution |
| Visuel | **Aucune**, pour la même raison |

### 7.2 Preuves attendues de `CRM-036` et `CRM-037`

| Niveau | Preuves attendues |
|---|---|
| pgTAP | Champ `required` manquant → transition refusée ; champ `hidden` non exigé même si vide ; union étape + transition ; valeur de type incorrect refusée ; règle ajoutée après coup n'invalide pas une card déjà en place |
| API | Écriture d'une valeur par un `viewer` → refusée ; écriture sur une card d'un autre workspace → refusée |
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
4. **La forme des entrées de `choices` n'est pas contrainte par la base** (§2.4). Elle le sera par
   la validation de `CRM-036`, ou pas du tout si le responsable juge le coût supérieur au risque.
