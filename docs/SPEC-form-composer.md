# Spécification — Form composer (champs conditionnels)

Unités de backlog : `CRM-035` à `CRM-037` (voir `docs/BACKLOG.md`).
Documents liés : `docs/SCHEMA.md` §4, `docs/SPEC-workflow-engine.md`,
`docs/DESIGN_SYSTEM.md` §5.7.

---

## 1. Intention

Chaque card affiche un formulaire dont les champs **dépendent de son étape courante**. Une card
en prospection ne demande pas les mêmes informations qu'une card en signature. Le formulaire est
donc une donnée attachée au workflow, pas un composant codé en dur.

Deux besoins distincts, souvent confondus, sont traités séparément :

- **Visibilité** : quels champs montrer à cette étape ?
- **Obligation** : quels champs doivent être renseignés **pour quitter** cette étape ?

## 2. Définition des champs

Les champs (`form_fields`) appartiennent à un **workflow**, pas à un channel : deux channels
partageant un workflow partagent son formulaire, ce qui est cohérent avec la copie vers un track
(la copie duplique aussi les champs).

Types supportés :

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

Les valeurs sont stockées en `jsonb` dans `card_field_values`. Le type déclaré détermine la
validation ; une valeur qui ne correspond pas au type est refusée à l'écriture.

## 3. Règles conditionnelles

`form_field_rules` associe un champ et une étape à une visibilité :

| Valeur | Effet à cette étape |
|---|---|
| `hidden` | Le champ n'est ni affiché ni exigé |
| `visible` | Le champ est affiché, facultatif |
| `required` | Le champ est affiché et **exigé pour entrer dans cette étape** |

**Absence de règle pour un couple champ/étape : le champ est `visible`.** Ce choix évite d'avoir
à déclarer une règle par étape pour les champs courants.

### Sémantique de `required`

Un champ `required` sur l'étape *E* est exigé **au moment où une card entre dans *E***, contrôlé
par `move_card`. Il n'est pas exigé pour enregistrer une valeur partielle pendant que la card est
ailleurs : on n'empêche jamais un utilisateur de saisir progressivement ses informations.

Les données déjà existantes ne sont jamais invalidées rétroactivement : une card entrée dans *E*
avant l'ajout d'une règle `required` y reste, et le champ manquant est signalé dans l'interface
sans bloquer la lecture.

### Champs exigés par une transition

Une transition peut exiger des champs supplémentaires (`workflow_transitions.require_fields`),
indépendamment de l'étape cible. L'ensemble effectivement contrôlé est l'union des champs
`required` de l'étape cible et des `require_fields` de la transition empruntée.

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
