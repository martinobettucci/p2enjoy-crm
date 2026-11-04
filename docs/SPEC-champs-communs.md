# Spécification — Champs personnalisés communs de portée espace

- Unité de backlog : **`CRM-112`** — « Champs personnalisés communs de portée espace ». Livrée **après** `CRM-111`
  (décision 645) : elle pose ses champs dans la partie commune de la fiche, que `CRM-111` sépare des blocs.
- Arbitrages : `docs/JOURNAL.md`, décisions **642** (arbitrage 4 : champs communs de portée espace ; connecteur MCP,
  famille `affaires`, action `modifier`), **639** (arbitrage 3 : écriture des parties communes), **645** (deux unités,
  ordre), **658** (langue des noms), **664** (les huit points de ce document), **665** (validation).
- Documents liés : `docs/SPEC-rattachements.md` §3, §5 et §8, `docs/SPEC-form-composer.md` §2, §3 et §6,
  `docs/SPEC-cards.md` §12 (vue liste), `docs/SPEC-modeles-emails.md` §2 (variables), `docs/SPEC-recherche.md`,
  `docs/SPEC-workflow-engine.md` (garde de `move_card`), `docs/SCHEMA.md` §4, `docs/SPEC-permissions-rls.md` §3,
  `docs/SPEC-ia.md` §14.5 (`CRM-113`), `docs/SPEC-mcp.md` §6.1 et §9.2, `docs/DAT.md` §12 bis.
- État : **validée par le responsable le 2026-10-24** (décision 665). Le code ne commence qu'après la tranche T2 de
  `CRM-111` (décision 645).

Les passages marqués **[proposition]** sont des choix de rédaction de l'agent, acceptés avec la validation de la
spécification ; la tranche T1 les confronte aux mesures, et tout écart revient au responsable.

---

## 1. Objet

Un **administrateur** définit des champs au niveau de l'**espace** : « SIRET du client », « Secteur », « Référence
contrat ». Ils paraissent dans la **partie commune** de la fiche de **toute** affaire de l'espace, à côté des champs
natifs, quels que soient ses rattachements. Un champ commun a **une seule valeur par affaire**, partagée par tous les
rattachements, à l'inverse des champs de workflow, qui vivent dans les blocs (`docs/SPEC-rattachements.md` §3.3).

Un champ commun sert **partout où sert un champ de l'affaire** (décision 664, arbitrage 4) :
- dans la **fiche** (§7) ;
- comme **exigence d'une transition** (§5) ;
- comme **colonne et filtre** de la vue liste (§8) ;
- comme **variable** des modèles d'email (§9) ;
- dans la **recherche globale** (§10).

**Connecteur MCP : oui pour les valeurs, non pour les définitions** (décisions 642 et 664) — §11.

## 2. Ce que la base porte aujourd'hui — mesuré le 2026-10-24 sur la pile locale

**`public.form_fields`** appartient à un workflow, et ce lien est structurel :

- clé composite `(workflow_id, workspace_id) → workflows`, `UNIQUE (id, workflow_id)` et `UNIQUE (workflow_id, key)` ;
- trois tables le référencent : `form_field_rules` (visibilité par **étape**) et `card_field_values`, par le couple
  `(field_id, workflow_id)` ; `workflow_transition_required_fields`, par `field_id` ;
- trois fonctions le lisent comme une partie de la **composition** du workflow : `app.workflow_composition_document`
  (versions immuables, `CRM-078`), `copy_workflow_to_track` (copies, `CRM-032`), `app.defauts_proposition_ia`
  (assistant IA, `CRM-097`) ;
- politiques : lecture par tout membre de l'espace, insertion et mise à jour par l'administrateur, aucune suppression ;
- 18 champs et 23 valeurs dans la base de développement seedée.

**La validation par type** est portée par le déclencheur `app.card_field_values_valider` : forme selon le type, et
résolution des types `contact` et `user` dans l'espace de la valeur (`docs/SPEC-form-composer.md` §6.4 et §6.5).

**Les modèles d'email** exposent douze variables pointées, en anglais — `card.title`, `card.amount`, `card.step`,
`contact.full_name`, `identity.from_name`… —, validées à l'écriture contre une liste fermée
(`docs/SPEC-modeles-emails.md` §2). **Ni eux, ni la vue liste, ni la recherche globale** ne lisent aujourd'hui un champ
de formulaire.

## 3. Le modèle

### 3.1 Deux tables distinctes, et non une portée ajoutée à `form_fields` (décision 664, arbitrage 1)

Ajouter une portée « espace » à `form_fields` rendrait `workflow_id` nullable. Les clés composites qui garantissent
qu'une valeur ou une règle ne croisent pas deux workflows perdraient leur charnière, et les trois fonctions de
composition devraient toutes exclure les champs d'espace : un oubli ferait entrer un champ commun dans une version,
une copie ou une proposition de l'assistant. Deux tables distinctes gardent ces invariants intacts.

### 3.2 `public.card_common_fields` — la définition

| Colonne | Type | Règle |
|---|---|---|
| `id` | `uuid` | PK ; `UNIQUE (id, workspace_id)` |
| `workspace_id` | `uuid` | non nul, FK `workspaces` `on delete cascade` |
| `key` | `text` | non nul, `^[a-z0-9]+(-[a-z0-9]+)*$`, **unique par espace**, archivés compris ; **non modifiable** après création, car les modèles d'email la citent (§9) **[proposition]** |
| `label` | `text` | non nul, non vide |
| `type` | `text` | les quinze types de `form_fields`, **même** `CHECK` |
| `options` | `jsonb` | objet ; mêmes contraintes que `form_fields` (`choices` pour `select` et `multiselect`, `currency` pour `money`) |
| `help_text` | `text` | facultatif, non vide si fourni |
| `is_listed` | `boolean` | non nul, défaut faux : le champ est proposé comme **colonne** de la vue liste (§8) **[proposition]** |
| `position` | `numeric` | ordre dans la partie commune ; attribuée par déclencheur |
| `archived_at` | `timestamptz` | archivé : masqué, réversible ; **aucune suppression** ; archivage gardé (§6) |
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
`app.validate_field_value(p_type, p_options, p_value, p_workspace)`, nommée selon la règle 4 de la décision 658. Les deux
déclencheurs l'appellent : un type n'a **qu'une seule** validation. Le déclencheur existant garde son nom jusqu'au lot 8
du plan d'INC-286.

**« Renseigné »** suit la définition unique de `app.valeur_de_champ_est_vide` (`docs/SPEC-form-composer.md` §6.6) : la
garde des transitions (§5) et l'interface lisent la même règle.

## 4. Autorisations — appliquées en base (`CLAUDE.md` §10)

| Objet ou geste | Autorisé lorsque |
|---|---|
| Lire la **définition** | tout membre de l'espace — `app.is_workspace_member`, comme `form_fields` |
| Créer, modifier, réordonner, archiver un champ | administrateur de l'espace — `app.is_workspace_admin` |
| Exiger un champ commun dans une transition | administrateur — comme toute exigence de transition |
| Lire une **valeur** | l'appelant lit l'affaire — `app.can_read_card` (après `CRM-111` : au moins un channel rattaché lisible) |
| Écrire une **valeur** | l'appelant écrit l'affaire — `app.can_write_card` (après `CRM-111` : au moins un channel rattaché écrivable, décision 639) |

Aucune suppression de valeur : vider, c'est écrire `'null'::jsonb` (`docs/SPEC-form-composer.md` §6.9).

**Politiques** (décision 658, règle 7) : `card_common_fields_select_member`, `card_common_fields_insert_admin`,
`card_common_fields_update_admin`, `card_common_field_values_select`, `card_common_field_values_insert`,
`card_common_field_values_update`.

## 5. Exigible par une transition (décision 664, arbitrage 2)

Un champ commun n'a pas d'étape : il n'est jamais `required` par la visibilité d'une étape, et jamais exigé à la
création. Une **transition** peut en revanche l'exiger : « pour passer en Signé, le SIRET est renseigné ».

- **Une table distincte, `workflow_transition_required_common_fields`** (`transition_id`, `common_field_id`,
  `workspace_id`), clé primaire `(transition_id, common_field_id)` — **révisé par la décision 819** (2026-11-03). La
  colonne `common_field_id` sur `workflow_transition_required_fields`, prévue d'abord, aurait remplacé sa clé primaire
  `(transition_id, field_id)`. Or le connecteur MCP nomme son refus `already_required` d'après cette clé, et les fonctions
  de photographie, de comparaison et de restauration des versions lisent `field_id` comme non nul. La table distincte les
  laisse intactes. Le champ commun doit appartenir à l'**espace du workflow** : `workspace_id` est posé depuis la
  transition, et une clé composite le relie à `card_common_fields`. Les mêmes politiques que pour les champs de workflow
  s'appliquent : lecture par les membres, écriture et retrait par l'administrateur.
- **La sixième vérification de `move_card`** (`docs/SPEC-form-composer.md` §6.7) contrôle l'union des champs de workflow
  exigés, lus sur les valeurs du **rattachement**, et des champs communs exigés, lus sur les valeurs de l'**affaire**.
  Le refus reste `missing_required_fields`, et sa liste nomme les deux sortes de champs.
  **Livré par T2.b (migration `0156`)** : les clés des champs de workflow manquants, puis celles des champs communs, dans
  le même `DETAIL`. **Reste à T3** : la webapp résout les clés du refus en libellés en lisant `form_fields`
  (`docs/SPEC-workflow-engine.md`, tableau des refus). Elle ne trouvera pas une clé de champ commun, et doit la chercher
  dans `card_common_fields`.
- **Versions de workflow** (`CRM-078`) : la composition photographiée référence le champ commun par son **identifiant**
  et sa **clé** ; elle ne le copie pas. Restaurer une version qui exige un champ commun archivé est **refusé**
  (`common_field_archived`) **[proposition]**.
  **Livré par T2.c.1 (migration `0157`)**.
  - Le document de composition porte `required_common_fields` (`transition_id`, `common_field_id`, `key`) **seulement
    quand le workflow en exige**. L'empreinte d'une composition sans exigence reste donc celle d'avant, et aucune copie
    existante ne se découvre divergente.
  - La restauration rétablit les exigences de la version ; une clé absente, celle d'une version antérieure, vaut
    « aucune ».
  - **Les comparaisons de versions** (`compare_workflow_versions`, `compare_workflow_with_source`) n'en parlent pas
    encore : la webapp les lit par une liste fermée de collections, et la collection nouvelle arrive avec son écran (T2.c.2,
    avec T3).
    *Précisé le 2026-11-03, avant le code de T2.c.2 (INC-344, migration `0161`)* : la collection `required_common_fields`
    entre dans les deux comparaisons, identité `(transition_id, common_field_id)` pour deux versions et `(from_node_id,
    to_node_id, common_field_key)` pour une copie et sa source ; le document naturalisé la porte toujours, vide s'il le
    faut. Sans elle, deux versions qui ne diffèrent que par une exigence commune rendaient `identical: false` et un résumé
    nul.
- **Copies vers un track** (`copy_workflow_to_track`) : une copie reste dans l'espace, donc elle garde l'exigence telle
  quelle.
- **Assistant IA** (`CRM-097`) : une proposition peut viser un champ commun existant comme exigence, par sa clé ; elle
  ne peut pas en créer un (§11).
  **Format arrêté par la décision 825** : une liste distincte, `exigences_communes` (`docs/SPEC-ia.md` §6.1).

## 6. Archiver un champ commun employé — refusé et nommé (décision 664, complément 1)

L'archivage est **refusé** par la base, avec le code `common_field_in_use`, tant que le champ est :
- **exigé** par une transition d'un workflow de l'espace ;
- **employé** par un modèle d'email de l'espace (sujet ou corps).

La réponse nomme les transitions et les modèles concernés. L'administrateur retire d'abord l'exigence, ou corrige le
modèle. C'est la doctrine de `app.catalogue_refuser_archivage_noeud_occupe`. Un champ archivé qui porte des valeurs les
garde : désarchiver les rend.

## 7. Écrans d'administration et fiche

- **Réglages ▸ « Champs de l'affaire »** (`/reglages/champs`, composant `ReglagesChampsAffaire`) : la liste des champs
  communs ; créer, modifier, réordonner, archiver et désarchiver ; la case « Afficher dans la liste » (`is_listed`). Elle
  réemploie les éléments de l'éditeur de formulaire des workflows (`ElementsFormulaireAdmin`). Consultable par tout
  membre, commandes réservées à l'administrateur par la capacité d'administration de `CRM-093`
  (`docs/DESIGN_SYSTEM.md` §5.59). Un refus `common_field_in_use` affiche la liste qu'il nomme.
  *Précisé le 2026-11-03, avant le code de T3.a (`docs/DESIGN_SYSTEM.md` §5.86)* : la case « Afficher dans la liste »
  arrive avec T4, qui pose la colonne qu'elle commande ; rendue avant, elle ne commanderait rien. L'entrée de l'index
  vient après « Workflows ».
- **L'éditeur de workflow** : parmi les champs qu'une transition peut exiger, les champs communs de l'espace, marqués
  comme tels.
  *Précisé le 2026-11-03, avant le code de T3.b (`docs/DESIGN_SYSTEM.md` §5.87)* : l'aperçu des effets d'une exigence
  (`docs/SPEC-workflow-engine.md` §7 bis.13) vaut aussi pour un champ commun, par une fonction propre,
  `public.preview_common_field_requirement(p_common_field_id, p_transition_id) returns table (at_entry bigint)` — `security
  invoker`, la lecture de l'appelant fait foi : le nombre d'affaires distinctes dont un rattachement non archivé est à
  l'étape de départ de la transition et dont la valeur commune est vide (`app.valeur_de_champ_est_vide`), `0` pour un
  champ archivé ou inconnu. Écrire et retirer l'exigence passent par PostgREST sur
  `workflow_transition_required_common_fields`, sous ses politiques (`0155`). **Connecteur MCP : non** — exiger un champ
  est une définition (décision 664).
- **La fiche** : les champs communs non archivés paraissent dans la partie commune, sous les champs natifs, dans
  l'ordre de `position`. Ils sont éditables par qui écrit l'affaire, sinon en lecture seule. Un champ archivé qui porte
  une valeur reste lisible, marqué archivé ; un champ archivé vide disparaît **[proposition]**. Un champ exigé par une
  transition refusée est signalé comme les champs de workflow (`docs/SPEC-form-composer.md` §4.4).
  *Précisé le 2026-11-03, avant le code de T3.c (`docs/DESIGN_SYSTEM.md` §5.88)* : la partie commune est un bloc « Champs
  de l'affaire », juste après « Rattachements ». Une valeur s'écrit dans `card_common_field_values` : une mise à jour de
  la ligne de l'affaire si elle existe, une insertion sinon (le privilège de colonne n'accorde la mise à jour que de
  `value`, ce qui interdit l'`upsert` de PostgREST, qui réécrit toutes les colonnes envoyées) ; une insertion concurrente
  refusée en `23505` est reprise en mise à jour. Le board résout les clés communes d'un `missing_required_fields` en
  libellés par la lecture de `card_common_fields`, et la fiche les reçoit par `exiges`, comme les autres.
- **Timeline** : une valeur changée écrit `field_changed`, avec un `placement_id` **nul** (« partie commune »,
  `docs/SPEC-rattachements.md` §5) et un `payload` qui porte `field_id` et `scope: "common"` **[proposition]**.
  *Précisé le 2026-11-03, avant le code de T3.d (migration `0163`, `docs/DESIGN_SYSTEM.md` §5.89)* : un déclencheur après
  insertion et mise à jour de `card_common_field_values` écrit l'événement par `app.card_event_ecrire`, avec `from` (une
  mise à jour) et `to`, et rien quand la valeur ne change pas — la règle du déclencheur des champs de workflow.
  `app.card_events_fill_placement`, qui rattache aujourd'hui tout `field_changed` au premier rattachement, laisse le
  rattachement **nul** quand `payload.scope = 'common'`. Le fil lit tous les événements d'une affaire : la ligne paraît
  donc sur la fiche de chaque rattachement. Les webhooks reçoivent l'événement comme tout `field_changed`.

## 8. Vue liste : colonnes et filtres (décision 664, arbitrage 4)

- **Colonnes** : les champs communs non archivés dont `is_listed` est vrai sont des colonnes de la vue liste d'un
  channel, après les colonnes natives (`docs/SPEC-cards.md` §12.7), dans l'ordre de `position`. Le choix des colonnes est
  **une donnée de l'espace, fixée par l'administrateur** : aucune préférence par personne n'est stockée sur l'appareil
  (`CLAUDE.md` §11) **[proposition]**. La valeur est mise en forme selon son type, comme dans la fiche.
- **Filtres**, selon le type **[proposition]** :

| Type | Filtre |
|---|---|
| `text`, `textarea`, `email`, `phone`, `url` | contient |
| `select` | est l'un des choix cochés |
| `multiselect` | contient l'un des choix cochés |
| `number`, `money` | entre deux bornes, chacune facultative |
| `date`, `datetime` | entre deux dates, chacune facultative |
| `checkbox` | oui, non, vide |
| `user`, `contact` | est cette personne, ce contact |
| `file` | renseigné ou vide |

- **Le filtre s'applique au serveur**, dans la même requête paginée que les filtres existants (`docs/SPEC-cards.md`
  §12.5 et §12.6), par une jointure sur `card_common_field_values`. Le total et la pagination restent exacts. Le coût est
  mesuré en T1 sur le seed.
- **Mesuré en T1, le 2026-11-02**, sous le rôle réel de Driss (RLS comprise), dans une transaction annulée :
  - **sur le seed** (44 affaires, une valeur par affaire), la liste du canal le plus peuplé passe de 11 ms à **40 ms** avec
    le filtre « contient ». Le surcoût est la politique de lecture de `card_common_field_values`
    (`app.can_read_card`), évaluée sur chaque valeur du champ : 25 ms pour 44 lignes ;
  - **à 4 400 valeurs** (100 champs × 44 affaires), le filtre reste à **20 ms**, car l'index `field_id` restreint d'abord
    aux 44 valeurs du champ.

  **Conséquence pour T4** : le coût croît avec le nombre d'affaires qui portent le champ, à raison d'environ 0,5 ms
  chacune. Le placement est déjà lu sous sa RLS ; T4 doit donc vérifier la valeur sans réévaluer les droits ligne à ligne
  **[proposition]**.
- **L'état de la vue** (filtres actifs) suit la règle existante de la liste, sans stockage nouveau.
- *Précisé le 2026-11-03, avant le code de T4.a (`docs/DESIGN_SYSTEM.md` §5.91)* : T4 est découpée — T4.a les colonnes,
  T4.b les filtres. Les valeurs d'une page sont **plongées** dans la requête de la liste (`card_common_field_values`, sous
  sa RLS) ; aucune lecture par ligne. Les types `user`, `contact` et `file` ne s'affichent pas en colonne : leur valeur est
  un identifiant que la liste ne nomme pas sans une lecture de plus ; la case « listé » leur est refusée à l'écran, et la
  liste les ignore si la base les porte listés.
- *Précisé le 2026-11-03, avant le code de T4.b (`docs/JOURNAL.md` décision 831, `docs/DESIGN_SYSTEM.md` §5.92)* :
  - **T4.b filtre les champs actifs de tous les types sauf personne, contact et fichier**, listés ou non : lister fait une
    colonne, pas un filtre. Les trois autres types sont la tranche **T4.c** (un filtre qui doit nommer une personne, un
    contact, un fichier) ; les vues sauvegardées qui gardent ces filtres sont **T4.d**, à arbitrer par le responsable
    (la liste des clés d'une vue est fermée en base, `docs/SPEC-vues-import-export.md` §2.2).
  - **L'adresse porte chaque filtre** sous `c.<clé du champ>` — la clé ne change jamais (§3.1) : `c.siret=123` (contient),
    `c.secteur=btp,sante` (choix), `c.ca=1000..5000`, `c.ca=1000..`, `c.ca=..5000` (bornes), `c.echeance=2026-01-01..2026-03-31`
    (dates), `c.signe=oui|non|vide` (case). Une clé inconnue ou archivée, un choix inconnu, une borne illisible sont
    **ignorés sans erreur** (lecture tolérante, `docs/SPEC-cards.md` §12.2). « Effacer les filtres » les retire avec les
    autres ; la page revient à 1 à chaque changement, comme pour les autres filtres.
  - **Au serveur, dans la même requête** : chaque filtre actif plonge une fois `card_common_field_values` sous l'affaire,
    avec un alias propre (`c1`, `c2`…), en `!inner`, borné à son champ (`field_id=eq.`) et à sa condition ; le total et
    la pagination restent exacts (mesuré : deux filtres combinés, 13 lignes sur 28, total juste). « Vide » (case)
    plonge **sans** `!inner` et ne garde que l'affaire sans valeur non vide (`value` ni nulle ni `null` JSON) — mesuré :
    3 valeurs vidées et 2 absentes rendent 5 lignes.
  - **Les conditions, par type** : contient — `value_search` (ci-dessous) `like` le texte saisi, ramené en minuscules et
    sans accents par l'écran, comme la recherche de la liste ignore les accents (décision 532) ; choix — un `or` de
    `value=eq."<choix>"` ; plusieurs choix — un `or` de `value=cs.["<choix>"]` (contient l'un des choix) ; nombre et
    montant — `value` entre les bornes (la comparaison du JSON est numérique) ; date — `value_date` entre les bornes ;
    date et heure — `value_timestamp` entre minuit du premier jour et minuit du lendemain du dernier, à l'heure de
    l'appareil ; case — `value` égale `true` ou `false`, ou « vide ».
  - **Une migration ajoute trois colonnes posées par la base**, jamais par l'appelant (aucun droit d'écriture), par le
    déclencheur de validation existant : `value_search` (texte en minuscules sans accents, pour les types texte),
    `value_date` (type `date`), `value_timestamp` (type `datetime`). *Motif mesuré* : la validation accepte toute chaîne que
    PostgreSQL sait convertir (`::date`, `::timestamptz`) — comparer les chaînes JSON ne serait juste que pour l'ISO.
    Les valeurs existantes sont reprises par la migration, sans toucher à `updated_at`. Aucun index : le volume ne le
    justifie pas encore (`CLAUDE.md` §21) ; la mesure est refaite en T4.b.
  - **Le coût sous la RLS, mesuré le 2026-11-03** (5 champs × 45 affaires, canal de 28 rattachements, profil `bizdev`) :
    la liste passe de 9 ms à **30 ms** avec un filtre ; la politique de lecture de la valeur (`app.can_read_card`) est
    évaluée sur chaque valeur candidate, environ 0,5 ms chacune, comme en T1. La proposition de T1 — ne pas réévaluer
    les droits ligne à ligne — **n'est pas tenable par PostgREST** : un filtre sur une table plongée passe par sa
    politique. T4.b la remplace par une **mesure à refaire** : réécrire la politique de lecture en semi-jointure sur les
    rattachements lisibles, si elle rend le même droit, est mesuré avant le code ; à défaut, le coût est accepté et
    consigné au DAT, avec son seuil (environ 0,5 s pour 1 000 affaires porteuses du champ dans un channel).
    **Mesuré le 2026-11-03, la semi-jointure est retenue** : la politique de lecture des valeurs devient
    `card_id in (select p.card_id from card_placements p where p.channel_id in (select unnest(app.readable_channel_ids())))`
    — le même droit que `app.can_read_card` (un rattachement dans un channel lisible), sous la forme que `cards_lecture`
    emploie déjà. Sur la même sonde : **37,7 ms → 24,6 ms**, mêmes 27 lignes ; surtout, le coût ne croît plus avec le
    nombre de valeurs : `app.readable_channel_ids()` est évaluée une fois par requête (~5 ms) au lieu de
    `app.can_read_card` une fois par valeur. La même migration porte la politique ; une preuve pgTAP compare, profil par
    profil, les valeurs visibles par l'ancienne et la nouvelle règle.
  - **Le connecteur MCP** : le filtre de `crm_card_list` est la tranche T9 (décision 664) ; T4.b ne l'ajoute pas.
  - *Précisé au code, le 2026-11-03* : **« Exporter en CSV » ne retient pas ces filtres** — il passe par
    `export_cards(p_channel, p_filters)`, dont les filtres sont les clés fermées d'une vue (`docs/SPEC-vues-import-export.md`
    §2.2). Le panneau le dit ; l'export rejoint donc la tranche **T4.d**, avec les vues sauvegardées.
- *Arbitré le 2026-11-04 (`docs/JOURNAL.md` décision 837)* : **T4.d** — les vues sauvegardées et l'export CSV retiennent
  les filtres de champ ; **T4.c** — personne, contact et fichier sont filtrés ; **connecteur** — par T9 (`crm_card_list`,
  `crm_view_list`), famille « affaires », aucune famille nouvelle.
- *Précisé le 2026-11-04, avant le code de T4.d (décisions 837 et 838)* :
  - **Une vue garde ses filtres de champ sous la clé `common_fields`**, une forme structurée, en anglais (`docs/DAT.md`
    §12 bis), que la base valide et sait interpréter — jamais la forme brute de l'adresse :

    | Type du champ | Forme | Sens |
    |---|---|---|
    | texte | `{"contains": "<texte>"}` (200 caractères au plus) | `value_search` contient le texte, minuscules et accents ignorés |
    | choix | `{"any_of": ["<clé>", …]}` (50 au plus) | la valeur est l'une des clés |
    | choix multiple | `{"any_of": ["<clé>", …]}` | la valeur contient l'une des clés |
    | nombre, montant | `{"min": <nombre> \| null, "max": <nombre> \| null}`, l'un au moins | entre les bornes, incluses |
    | date, date et heure | `{"from": "AAAA-MM-JJ" \| null, "to": "AAAA-MM-JJ" \| null}`, l'un au moins | le jour, bornes incluses |
    | case | `{"is": "yes" \| "no" \| "empty"}` | `true`, `false`, ou aucune valeur |

    Au plus 50 champs, chacun par sa clé (la forme de `card_common_fields.key`). Une clé inconnue, archivée, ou d'un type
    qui ne correspond pas à la forme est **ignorée** à la lecture, comme l'adresse le fait (§12.2 de `docs/SPEC-cards.md`).
    L'écran traduit cette forme vers ses paramètres `c.<clé>` et retour.
  - **`time_zone`**, clé facultative des filtres d'une vue ou d'un export (un nom IANA connu de PostgreSQL) : le jour d'un
    champ date et heure s'y lit, comme l'écran le lit à l'heure de l'appareil. Absente : UTC.
  - **Une fonction unique interprète ces filtres en base**, `app.card_common_filters_match(card, filtres, fuseau)`,
    `security invoker` — la RLS de la personne s'applique ; `export_cards` l'emploie, et la validation des vues
    (`app.saved_view_filters_valid`) contrôle la forme.
  - **Découpage** : **T4.d.1** — la migration (la validation élargie, la fonction, `export_cards`) et sa preuve pgTAP ;
    **T4.d.2** — la webapp : une vue enregistre et rouvre ses filtres de champ, « Filtres modifiés depuis la vue » les
    compte, l'export les envoie avec le fuseau de l'appareil, la phrase du panneau est retirée ; manuel ; **T4.d.3** — le
    connecteur, **dans la même livraison** : `crm_card_list` applique les filtres de champ d'une vue (`view`), et
    `crm_view_list` les rend (part de T9 avancée, décision 837) ; sans elle, une vue lue par le connecteur rendrait plus
    d'affaires que l'écran.

## 9. Modèles d'email (décision 664, complément 2)

- Une variable **`{{card.field.<clé>}}`** par champ commun non archivé de l'espace : `{{card.field.siret}}`,
  `{{card.field.reference-contrat}}`. Ce préfixe ne peut pas entrer en collision avec les variables natives.
- `app.mail_template_variables` et le contrôle d'écriture des modèles acceptent les clés des champs communs **de
  l'espace du modèle** ; une clé inconnue reste refusée. **Mesuré le 2026-10-24** : ce contrôle est aujourd'hui deux
  contraintes `CHECK`, `mail_templates_subject_variables` et `mail_templates_body_variables`, sur
  `app.mail_template_variables_inconnues(texte)`, qui ne reçoit pas l'espace. Une contrainte ne lisant pas de table de
  façon fiable, le contrôle des variables passe à un **déclencheur** sur `mail_templates`, qui lit les champs communs de
  l'espace ; le message de refus reste celui d'aujourd'hui. L'archivage gardé du §6 empêche qu'une clé employée
  disparaisse ensuite.
- **Rendu** (`rendre_modele_email`) : la valeur est mise en forme selon son type — date et montant au format français,
  libellé du choix, nom de la personne ou du contact ; un champ vide rend une **chaîne vide**.
- Le sélecteur de variables de l'éditeur de modèles liste les champs communs sous leur libellé.

## 10. Recherche globale (décision 664, complément 3)

- **Indexés** : les valeurs des types `text`, `textarea`, `email`, `phone`, `url`, et le **libellé** des choix pour
  `select` et `multiselect`. Ne sont pas indexés : `number`, `money`, `date`, `datetime`, `checkbox`, `user`,
  `contact`, `file`, ni les champs archivés.
- Un résultat trouvé par un champ commun **nomme ce champ** (« trouvé dans SIRET : 123 456 789 »).
- Les **droits** sont ceux de l'affaire : `recherche_globale` reste `security invoker`, et la RLS de
  `card_common_field_values` fait le reste (`docs/SPEC-recherche.md`). La forme de l'index (colonne générée sur `cards`
  ou index propre) est mesurée en T1.
- **Mesuré en T1, le 2026-11-02**, à 4 400 valeurs :
  - **sous la RLS**, la recherche plein texte (`to_tsvector('app.francais_sans_accent', value #>> '{}') @@ …`) prend
    **1,8 s**, avec ou sans index GIN d'expression. L'opérateur n'étant pas `leakproof`, le planificateur évalue
    `app.can_read_card` sur chaque ligne avant d'employer l'index ;
  - **sans RLS**, le même index répond en **0,03 ms** ;
  - **en employant d'abord l'index, puis en appliquant les droits aux seules lignes trouvées**, la recherche prend
    **9,4 ms**.

  **Forme retenue pour T6 [proposition, à arbitrer]** : un index propre sur `card_common_field_values`, une colonne
  `tsvector` tenue par déclencheur, car le libellé d'un choix ne s'obtient qu'en lisant les options de la définition et
  aucune expression d'index ne peut joindre. La lecture passe par une fonction `security definer` qui interroge l'index puis
  applique `app.can_read_card` aux seules affaires trouvées, et ne rend jamais un identifiant illisible.
  `recherche_globale` reste `security invoker`.

## 11. Connecteur MCP (décisions 642 et 664, arbitrage 3)

| Action | Outils |
|---|---|
| `consulter` | `crm_card_get` rend les champs communs et leurs valeurs ; `crm_common_field_list` liste les définitions de l'espace ; `crm_card_list` peut filtrer par champ commun, avec les filtres du §8 |
| `modifier` | `crm_card_update` écrit les valeurs, désignées par leur `key` |

Famille `affaires` (`cards` après le lot 1 d'INC-286), au catalogue de `CRM-104` (`docs/SPEC-mcp.md` §9.2). **Le
connecteur ne définit pas les champs** : créer, modifier ou archiver un champ commun, ou l'exiger dans une transition,
reste un geste d'administrateur dans la webapp, comme l'édition des workflows.

## 12. Interactions avec les autres unités

- **`CRM-111`** fournit la partie commune de la fiche, la règle d'écriture « un channel suffit » et `placement_id` dans
  `card_events`. `CRM-112` ne commence qu'après sa tranche T2.
- **`CRM-113`** apprend au générateur de workflow les champs natifs de l'affaire, pour qu'il n'en propose pas de doublon
  (`docs/SPEC-ia.md` §14.5). Les champs communs de l'espace rejoignent cette liste (T7).
- **`CRM-063`** (modèles d'email) et **`CRM-065`** (recherche globale) voient leurs contrats étendus, dans
  `docs/SPEC-modeles-emails.md` et `docs/SPEC-recherche.md`, par les tranches T5 et T6.

## 13. Seed

Par les vraies écritures de l'application :
- quatre champs communs : `siret` (texte, listé), `secteur` (choix, listé), `date-signature` (date), `budget-client`
  (montant) ;
- des valeurs sur les affaires de démonstration, dont l'affaire à deux rattachements de `CRM-111` ;
- un champ **archivé** qui porte une valeur ;
- une transition du workflow de démonstration qui **exige** `siret`, et une affaire bloquée par elle ;
- un modèle d'email qui emploie `{{card.field.siret}}` ;
- la lectrice du seed, qui lit les valeurs sans pouvoir les écrire.

## 14. Preuves attendues

| Niveau | Preuve |
|---|---|
| pgTAP | clés composites (une valeur ne croise pas deux espaces) ; validation par type partagée ; `CHECK` exclusif de l'exigence ; sixième vérification avec un champ commun ; `common_field_in_use` pour une exigence et pour un modèle ; `common_field_archived` à la restauration ; une mutation tuée par règle |
| API, avec les jetons réels | la lectrice lit et n'écrit pas ; un non-administrateur ne définit pas ; un membre qui écrit un seul channel rattaché écrit la valeur ; filtre et pagination exacts ; variable refusée pour une clé inconnue, acceptée pour une clé de l'espace ; recherche sous les droits |
| Unitaires | l'écran d'administration ; la partie commune de la fiche ; les filtres par type ; la mise en forme du rendu |
| E2E | définir un champ ; le renseigner depuis la fiche ; le voir en colonne et filtrer ; être refusé par une transition qui l'exige, puis passer ; l'employer dans un modèle et prévisualiser ; le trouver par la recherche ; archivage refusé puis permis |
| Visuel | captures JPEG de l'écran d'administration, de la fiche, de la liste filtrée, du refus de transition, aux quatre paliers |
| MCP | `crm_common_field_list`, la lecture et l'écriture des valeurs, le filtre de `crm_card_list`, contre la vraie base |

## 15. Tranches proposées

| Tranche | Contenu |
|---|---|
| T1 | Mesures : coût du filtre et de l'index de recherche sur le seed. Migration : les deux tables, politiques, `app.validate_field_value` partagée ; pgTAP ; API ; `docs/SCHEMA.md` ; contrat de déploiement |
| T2 | Exigence par une transition : `common_field_id`, sixième vérification, versions et copies, `common_field_in_use`, `common_field_archived` ; pgTAP ; API |
| T3 | Écrans : Réglages ▸ « Champs de l'affaire », exigence dans l'éditeur de workflow, partie commune de la fiche, timeline ; design system ; unitaires |
| T4 | Vue liste : colonnes et filtres au serveur ; unitaires ; API |
| T5 | Modèles d'email : variables, contrôle d'écriture passé des deux `CHECK` à un déclencheur, rendu, sélecteur ; archivage gardé par l'emploi |
| T6 | Recherche globale : index et résultat nommé |
| T7 | `CRM-113` : les champs communs rejoignent les champs que le générateur ne doit pas doublonner |
| T8 | Seed du §13, E2E, captures, `docs/manual.md` (chapitre « Les champs communs de l'affaire ») |
| T9 | Outils MCP du §11 |
| — | Livraison en production avec `CRM-111` ou après elle, sur instruction du responsable |

## 16. Hors périmètre

- Des champs communs **par track** : écartés par la décision 642 au profit de la portée espace.
- **Définir** un champ par le connecteur MCP (décision 664, arbitrage 3).
- Un champ commun **obligatoire à la création**, ou par la visibilité d'une étape (décision 664, arbitrage 2).
- La **migration** de champs de workflow existants vers des champs communs : un administrateur qui veut « promouvoir »
  un champ le recrée, et les valeurs existantes ne sont pas déplacées **[proposition]**.
- Les **champs de workflow** comme colonnes, filtres, variables ou index de recherche : cette unité ne le fait que pour
  les champs communs.
