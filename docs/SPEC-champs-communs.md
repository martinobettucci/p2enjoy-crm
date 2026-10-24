# Spécification — Champs personnalisés communs de portée espace

- Unité de backlog : **`CRM-112`** — « Champs personnalisés communs de portée espace ». Livrée **après** `CRM-111`
  (décision 645) : elle pose ses champs dans la partie commune de la fiche, que `CRM-111` sépare des blocs.
- Arbitrages : `docs/JOURNAL.md`, décisions **642** (arbitrage 4 : champs communs de portée espace ; connecteur MCP,
  famille `affaires`, action `modifier`), **639** (arbitrage 3 : écriture des parties communes), **645** (deux unités,
  ordre), **658** (langue des noms).
- Documents liés : `docs/SPEC-rattachements.md` §3 et §8, `docs/SPEC-form-composer.md` §2, §3 et §6, `docs/SCHEMA.md` §4,
  `docs/SPEC-permissions-rls.md` §3, `docs/SPEC-ia.md` §14.5 (`CRM-113`), `docs/SPEC-mcp.md` §6.1 et §9.2,
  `docs/DAT.md` §12 bis.
- État : **brouillon, à valider par le responsable avant tout code** (`CLAUDE.md` §5).

Les passages marqués **[proposition]** sont des choix de rédaction de l'agent ; ceux marqués **[à trancher]** sont
listés au §11.

---

## 1. Objet

Un **administrateur** définit des champs au niveau de l'**espace** : « SIRET du client », « Secteur », « Référence
contrat ». Ils paraissent dans la **partie commune** de la fiche de **toute** affaire de l'espace, à côté des champs
natifs (titre, description, contacts), quels que soient ses rattachements. Un champ commun a **une seule valeur par
affaire**, partagée par tous les rattachements, à l'inverse des champs de workflow, qui vivent dans les blocs
(`docs/SPEC-rattachements.md` §3.3).

**Connecteur MCP : oui** pour les **valeurs** (décision 642) : famille `affaires`, action `modifier` ; lecture par
`consulter`. La **définition** des champs : §11, point 3.

## 2. Ce que la base porte aujourd'hui — mesuré le 2026-10-24 sur la pile locale

**`public.form_fields`** appartient à un workflow, et ce lien est structurel :

- clé composite `(workflow_id, workspace_id) → workflows`, `UNIQUE (id, workflow_id)` et `UNIQUE (workflow_id, key)` ;
- trois tables le référencent par le couple `(field_id, workflow_id)` ou par `field_id` : `form_field_rules` (visibilité
  par **étape**), `card_field_values`, `workflow_transition_required_fields` ;
- trois fonctions le lisent comme une partie de la **composition** du workflow : `app.workflow_composition_document`
  (versions immuables, `CRM-078`), `copy_workflow_to_track` (copies, `CRM-032`), `app.defauts_proposition_ia`
  (assistant IA, `CRM-097`) ;
- politiques : lecture par tout membre de l'espace, insertion et mise à jour par l'administrateur, aucune suppression ;
- 18 champs et 23 valeurs dans la base de développement seedée.

**La validation par type** est portée par le déclencheur `app.card_field_values_valider` : forme selon le type, et
résolution des types `contact` et `user` dans l'espace de la valeur (`docs/SPEC-form-composer.md` §6.4 et §6.5).

**Ni les modèles d'email** (`app.mail_template_variables`) **ni la recherche** (`recherche_globale`) ne lisent
aujourd'hui les champs de formulaire.

## 3. Le modèle

### 3.1 Deux tables distinctes, et non une portée ajoutée à `form_fields` [proposition, §11 point 1]

**Motif.** Ajouter une portée « espace » à `form_fields` rendrait `workflow_id` nullable. Les trois clés composites
qui garantissent aujourd'hui qu'une valeur, une règle ou une exigence ne croisent pas deux workflows perdraient leur
charnière, et les trois fonctions de composition devraient toutes exclure les champs d'espace. Un oubli dans l'une
d'elles ferait entrer un champ commun dans une version de workflow, une copie ou une proposition de l'assistant. Deux
tables distinctes gardent ces invariants intacts, au prix d'une définition dupliquée de la validation, factorisée au
§3.3.

### 3.2 `public.card_common_fields` — la définition

**Nom** (décision 658, règle 1) : préfixé par l'objet qu'il décrit, comme `card_field_values` ; « commun » nomme la
portée **[proposition]**.

| Colonne | Type | Règle |
|---|---|---|
| `id` | `uuid` | PK ; `UNIQUE (id, workspace_id)` |
| `workspace_id` | `uuid` | non nul, FK `workspaces` `on delete cascade` |
| `key` | `text` | non nul, `^[a-z0-9]+(-[a-z0-9]+)*$`, **unique par espace**, archivés compris — comme `form_fields.key` |
| `label` | `text` | non nul, non vide |
| `type` | `text` | les quinze types de `form_fields`, **même** `CHECK` |
| `options` | `jsonb` | objet ; mêmes contraintes que `form_fields` (`choices` pour `select` et `multiselect`, `currency` pour `money`) |
| `help_text` | `text` | facultatif, non vide si fourni |
| `position` | `numeric` | ordre dans la partie commune ; attribuée par déclencheur |
| `archived_at` | `timestamptz` | archivé : masqué, réversible ; **aucune suppression** |
| `created_at`, `updated_at` | `timestamptz` | posés par la base |

### 3.3 `public.card_common_field_values` — les valeurs

| Colonne | Type | Règle |
|---|---|---|
| `card_id` | `uuid` | PK composite ; clé composite `(card_id, workspace_id) → cards` `on delete cascade` |
| `field_id` | `uuid` | PK composite ; clé composite `(field_id, workspace_id) → card_common_fields` `on delete cascade` |
| `workspace_id` | `uuid` | non nul ; **charnière** des deux clés composites : une valeur ne répond qu'à un champ de l'espace de son affaire |
| `value` | `jsonb` | nullable ; `NULL` et `'null'::jsonb` signifient vide, comme `card_field_values.value` |
| `updated_by` | `uuid` | FK `profiles` `on delete set null` |
| `created_at`, `updated_at` | `timestamptz` | posés par la base |

**La validation par type est factorisée [proposition].** Le cœur de `app.card_field_values_valider` est extrait dans
une fonction `app.validate_field_value(p_type, p_options, p_value, p_workspace)`, nommée selon la règle 4 de la décision
658. Les deux déclencheurs l'appellent, si bien qu'un type n'a **qu'une seule** validation. Le déclencheur existant
garde son nom : il n'est renommé que par le lot 8 du plan d'INC-286.

## 4. Autorisations — appliquées en base (`CLAUDE.md` §10)

| Objet ou geste | Autorisé lorsque |
|---|---|
| Lire la **définition** | tout membre de l'espace — `app.is_workspace_member`, comme `form_fields` |
| Créer, modifier, réordonner, archiver un champ | administrateur de l'espace — `app.is_workspace_admin` |
| Lire une **valeur** | l'appelant lit l'affaire — `app.can_read_card` (après `CRM-111` : au moins un channel rattaché lisible) |
| Écrire une **valeur** | l'appelant écrit l'affaire — `app.can_write_card` (après `CRM-111` : au moins un channel rattaché écrivable, décision 639) |

Aucune suppression de valeur : vider, c'est écrire `'null'::jsonb` (`docs/SPEC-form-composer.md` §6.9).

## 5. Obligatoire, ou non [à trancher, §11 point 2]

Un champ de workflow devient obligatoire par son **étape** (`form_field_rules.visibility = 'required'`) ou par une
**transition** (`workflow_transition_required_fields`). Un champ commun n'a pas d'étape. Trois formes sont possibles :

- **(a) jamais obligatoire** : un champ commun est une information, que l'on renseigne quand on la connaît **[recommandation]** ;
- **(b) exigible par une transition** : une transition d'un workflow peut exiger un champ commun (« pour passer en
  Signé, le SIRET est renseigné »). Cela étend `workflow_transition_required_fields` et la sixième vérification de
  `move_card`, et fait entrer une dépendance vers l'espace dans la composition du workflow ;
- **(c) obligatoire à la création** : il bloquerait `creer_affaire`, la création rapide et le connecteur.

## 6. Timeline

Une valeur changée écrit `field_changed`, comme un champ de workflow. Son `placement_id` est **nul**, ce qui signifie
« partie commune » (`docs/SPEC-rattachements.md` §5), et son `payload` porte `field_id` et `scope: "common"`
**[proposition]** ; la webapp en lit le libellé.

## 7. Écrans

- **Réglages ▸ « Champs de l'affaire »** (`/reglages/champs`) **[proposition]** : la liste des champs communs, créer,
  modifier, réordonner, archiver et désarchiver. Elle réemploie les éléments de l'éditeur de formulaire des workflows
  (`ElementsFormulaireAdmin`). Consultable par tout membre, commandes réservées à l'administrateur par la capacité
  d'administration de `CRM-093` (`docs/DESIGN_SYSTEM.md` §5.59).
- **La fiche** : les champs communs non archivés paraissent dans la partie commune, sous les champs natifs, dans
  l'ordre de `position`. Ils sont éditables par qui écrit l'affaire, sinon en lecture seule. Un champ archivé qui porte
  une valeur reste lisible dans la fiche, marqué archivé ; un champ archivé vide disparaît **[proposition]**.
- `docs/DESIGN_SYSTEM.md` et `docs/manual.md` (chapitre « Les champs communs de l'affaire ») sont mis à jour dans les
  tranches qui livrent ces écrans.

## 8. Connecteur MCP

| Action | Outils |
|---|---|
| `consulter` | `crm_card_get` rend les champs communs et leurs valeurs ; `crm_common_field_list` liste les définitions de l'espace **[proposition]** |
| `modifier` | `crm_card_update` écrit les valeurs des champs communs, désignés par leur `key` |

Famille `affaires` (`cards` après le lot 1 d'INC-286), au catalogue de `CRM-104` (`docs/SPEC-mcp.md` §9.2). La
**définition** des champs par le connecteur : §11, point 3.

## 9. Interactions avec les autres unités

- **`CRM-111`** fournit la partie commune de la fiche et la règle d'écriture « un channel suffit ». `CRM-112` ne
  commence qu'après sa tranche T2.
- **`CRM-113`** apprend au générateur de workflow les **champs natifs** de l'affaire, pour qu'il n'en propose pas de
  doublon (`docs/SPEC-ia.md` §14.5). Les champs communs de l'espace doivent rejoindre cette liste : un workflow ne doit
  pas recréer « SIRET » quand l'espace l'a déjà. La tranche qui le fait est nommée au §10.
- **Versions et copies de workflow** (`CRM-078`, `CRM-032`) : non touchées. Un champ commun n'entre jamais dans la
  composition d'un workflow.

## 10. Tranches proposées

| Tranche | Contenu |
|---|---|
| T1 | Migration : `card_common_fields`, `card_common_field_values`, politiques, `app.validate_field_value` et sa réutilisation par `card_field_values` ; pgTAP (clés composites, validation par type, droits, mutation tuée par règle) ; API aux jetons réels ; `docs/SCHEMA.md`, contrat de déploiement |
| T2 | Timeline (`field_changed` à `placement_id` nul) ; écran Réglages ▸ « Champs de l'affaire » ; unitaires ; design system |
| T3 | La fiche : champs communs dans la partie commune ; unitaires ; E2E ; captures aux quatre paliers ; manuel |
| T4 | Seed : trois champs communs (texte, choix, date), des valeurs sur les affaires de démonstration, un champ archivé portant une valeur ; campagne E2E |
| T5 | `CRM-113` : les champs communs rejoignent les champs que le générateur ne doit pas doublonner |
| T6 | Outils MCP du §8 |
| — | Livraison en production avec `CRM-111` ou après elle, sur instruction du responsable |

## 11. Points à trancher avant validation

1. **Deux tables distinctes** (§3.1), plutôt qu'une portée ajoutée à `form_fields` **[recommandation]**.
2. **Obligatoire** (§5) : (a) jamais **[recommandation]**, (b) exigible par une transition, (c) à la création.
3. **Définir les champs par le connecteur MCP** : **non** **[recommandation]** — c'est un geste d'administration de
   l'espace, comme l'édition des workflows, que le connecteur ne fait pas (la famille `structure` ne fait que lire les
   workflows) ; ou **oui**, avec une action `create` et `update` sur une famille à désigner.
4. **Ce qui reste hors périmètre de cette unité** : les champs communs comme **colonnes et filtres** de la vue liste,
   comme **variables des modèles d'email**, et dans la **recherche globale**. Aucun champ de workflow n'y est
   aujourd'hui ; **[recommandation]** des unités ultérieures, si le besoin se confirme.
5. **Les noms** : `card_common_fields`, `card_common_field_values`, `app.validate_field_value`,
   `crm_common_field_list`, et la route `/reglages/champs`.

## 12. Hors périmètre

- Des champs communs **par track** : écartés par la décision 642 au profit de la portée espace.
- La **migration** de champs de workflow existants vers des champs communs : un administrateur qui veut « promouvoir »
  un champ le recrée ; les valeurs existantes ne sont pas déplacées **[proposition]**.
