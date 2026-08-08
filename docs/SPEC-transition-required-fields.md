# Spécification — champs exigés par une transition

Contrat exécutable de `CRM-018`, issu de l'arbitrage du responsable qui remplace le tableau
`workflow_transitions.require_fields` par une relation (`docs/JOURNAL.md`, décision 262 ; INC-033).

- Unité de backlog : `CRM-018` (`docs/BACKLOG.md`).
- Modèle de workflow : `docs/SPEC-workflow-engine.md` §3 à §5.
- Formulaires : `docs/SPEC-form-composer.md` §3.5 et §6.7.
- Schéma : `docs/SCHEMA.md` §3 et §4.
- Déploiement : `docs/PROD_MIGRATIONS.md` §3 à §6.
- État : contrat spécifié ; mise en œuvre en cours.

---

## 1. Frontière

`CRM-018` corrige une propriété structurelle : un élément d'un `uuid[]` ne peut jamais porter de
clé étrangère. Elle ne change pas la règle métier. Une transition exige toujours l'union :

1. des champs dont la règle vaut `required` à l'étape cible ;
2. des champs liés explicitement à la transition.

Les exclusions existantes restent identiques : un champ archivé n'est pas exigé, une règle
`hidden` seule n'exige rien, et l'absence de valeur est définie par
`app.valeur_de_champ_est_vide(jsonb)`.

L'unité ne copie toujours pas les définitions de champs vers un workflow dérivé. INC-037 reste
donc ouvert. En revanche, elle cesse de recopier vers la transition dérivée une exigence qui
désigne un champ absent de ce workflow et que `move_card` ne pourrait pas résoudre. La source
garde sa liaison ; la copie n'en reçoit aucune tant que son formulaire n'est pas copié.

## 2. Table de liaison

La migration `supabase/migrations/0019_transition_required_fields.sql` crée :

```text
public.workflow_transition_required_fields
├── transition_id uuid not null
└── field_id      uuid not null
```

Contrat exact :

- clé primaire `(transition_id, field_id)` : une exigence n'est déclarée qu'une fois ;
- `transition_id → workflow_transitions(id) on delete cascade` ;
- `field_id → form_fields(id) on delete cascade` ;
- aucune colonne d'identité, aucun horodatage, aucune valeur mutable : modifier une liaison
  signifie la supprimer puis en créer une autre ;
- un trigger refuse en `23514`, `required_field_workflow_mismatch`, une liaison dont les deux
  parents n'appartiennent pas au même workflow — ce qui interdit aussi tout croisement de
  workspace.

Le workflow n'est volontairement pas une troisième colonne : il se déduit des deux parents, et le
trigger garantit leur égalité. Ajouter `workflow_id` aurait contredit la forme à deux colonnes
arbitrée sans donner une propriété supplémentaire. La contrainte opposable est donc : **même
workflow, cibles existantes, suppression en cascade**.

## 3. Migration des données existantes

La migration 19 doit fonctionner dans les deux états du dépôt :

- **mise à niveau** : la colonne `require_fields uuid[]` existe et peut porter des valeurs ;
- **base neuve** : les migrations historiques révisées ne créent plus cette colonne.

Sur une mise à niveau, dans la transaction du fichier :

1. chaque identifiant du tableau est résolu dans `form_fields` ;
2. un identifiant mort ou situé dans un autre workspace arrête la migration avec un diagnostic
   explicite — aucune exigence n'est perdue silencieusement ;
3. un identifiant valide du même workspace mais porté par une transition d'un autre workflow est
   recensé comme ancien artefact de copie, puis écarté : `move_card` l'ignorait déjà, donc aucun
   comportement n'est perdu ;
4. les autres liaisons sont remplacées par le dépliage exact des tableaux, doublons éliminés par
   la clé primaire ;
5. la colonne est supprimée seulement après l'insertion réussie.

Sur un rejeu où la colonne n'existe plus, les liaisons courantes sont conservées. Contraintes,
fonction du trigger, trigger, politiques, privilèges, définitions de `copy_workflow_to_track` et
`move_card` sont néanmoins ramenés au contrat. Une clé étrangère retirée ou affaiblie doit donc
être réparée sans reconstruire inutilement les contraintes déjà conformes.

## 4. Autorisation

La table porte RLS dès sa création :

| Geste | `anon` | membre | administrateur | `service_role` |
|---|---:|---:|---:|---:|
| Lire | zéro ligne | oui, dans son workspace | oui | oui |
| Créer | refus | refus | oui, parents du même workflow | oui |
| Supprimer | refus | refus | oui, dans son workspace | oui |
| Mettre à jour | refus | refus | refus — supprimer puis créer | oui |

Les politiques dérivent le workspace par jointure avec `workflow_transitions`; aucune colonne
dénormalisée n'est ajoutée. Le trigger de cohérence s'exécute aussi pour `service_role`, qui
contourne RLS : l'égalité des workflows ne dépend jamais seulement d'une politique.

Les privilèges sont révoqués explicitement à `public`, `anon`, `authenticated` et `service_role`
avant d'être rouverts au strict nécessaire. La fonction de trigger est `SECURITY DEFINER`, fixe
un `search_path` vide, appartient à `postgres` et n'est exécutable par aucun rôle API.

## 5. Appelants à réviser ensemble

### 5.1 `move_card`

La sixième garde ne lit plus `v_transition.require_fields`. Pour chaque champ actif du workflow de
la card, elle teste l'existence d'une ligne de liaison portant l'identifiant de la transition.
L'ordre du `DETAIL`, les six jetons d'erreur et tous les autres refus restent inchangés.

### 5.2 `copy_workflow_to_track`

La fonction copie les transitions, mais **aucune liaison**. Les champs restent rattachés au
workflow source ; recopier leur identifiant produisait une exigence inerte, ignorée par
`move_card`, et rendait le seed dépendant de l'âge de la base (INC-056). La suite exige donc zéro
liaison sur la copie tant qu'INC-037 n'a pas décidé comment copier le formulaire lui-même.

### 5.3 Seed

Les transitions sont créées sans champ tableau. Une fois `form_fields` présent, le seed :

1. relit les transitions du workflow global et de sa copie ;
2. supprime les liaisons divergentes des seules transitions déclarées par le seed ;
3. pose `lien-proposition` sur « Démarrer la réalisation » dans la source uniquement ;
4. relit exactement une liaison globale et zéro liaison dérivée, puis les nomme dans son résumé.

Les autres données, identifiants stables et comptes métier ne changent pas.

### 5.4 Types et clients

Les types générés perdent `workflow_transitions.require_fields` dans `Row`, `Insert` et `Update`,
et gagnent la table de liaison et ses relations. Les preuves d'API ne demandent plus la colonne
supprimée : elles lisent les liaisons, puis les transitions et champs qu'elles désignent.

## 6. Preuves minimales

La suite pgTAP `supabase/tests/0021_transition_required_fields.test.sql` prouve au minimum :

- forme exacte à deux colonnes, clé primaire et deux clés étrangères `on delete cascade` ;
- migration d'un tableau peuplé sans perte, puis absence de la colonne ;
- refus d'un parent absent et d'un croisement de workflows ;
- suppression d'une transition puis d'un champ, chacune retirant la liaison ;
- RLS, politiques, privilèges et fonction de trigger ;
- `move_card` refuse puis accepte selon la présence d'une valeur pour un champ lié ;
- `copy_workflow_to_track` ne recopie aucune liaison sans formulaire cible ;
- le seed porte une liaison globale et aucune dérivée, sans identifiant mort.

Les preuves d'API utilisent de vrais jetons : administrateur accepté, membre non administrateur
refusé, anonyme sans ligne, croisement de workflows refusé, suppression par `service_role` d'un
champ jetable suivie d'une relecture sans liaison. La suppression du champ seedé n'est jamais
employée comme fixture.

Le harnais rejouable dégrade réellement une clé étrangère, une politique, la définition de
`move_card` ou le seed, exige que les suites mordent, puis constate leur restauration. SQL global,
API global, UI Chromium à console stricte, mail, unitaires, types et build restent obligatoires.
Aucun écran ni capture nouvelle n'est dû : la table remplace un stockage backend sans ajouter de
geste interactif.

## 7. Déploiement et retour arrière

Avant application, recenser les identifiants morts et les croisements de workspaces dans les
tableaux. Un résultat non vide bloque la migration et demande une correction explicite.

Le retour arrière recrée `require_fields uuid[] not null default '{}'`, agrège les liaisons dans un
ordre stable, rétablit les deux fonctions historiques, puis supprime la table. Il est
structurellement réversible tant qu'aucune liaison ne désigne un champ supprimé — ce que les clés
étrangères garantissent. Il **réintroduit toutefois le défaut d'INC-033** : toute suppression
future peut de nouveau laisser un identifiant mort. Ce retour arrière n'est donc qu'un déblocage
temporaire, pas un état cible acceptable.
