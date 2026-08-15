// @verifies CRM-006 (docs/BACKLOG.md) — contrat des types générés depuis le schéma
// @verifies docs/SPEC-types.md §5 (fichier produit), §7 (ce que les types n'expriment pas)
// @verifies docs/SCHEMA.md §1 (socle d'identité) ; docs/INCONSISTENCY_REPORT.md INC-010
//
// Test **unitaire** du contrat de types. Il ne s'exécute pas : il se compile. Chaque assertion
// ci-dessous est une contrainte que `tsc --noEmit` vérifie, et qui fait échouer la compilation
// dès qu'elle cesse d'être vraie — parce qu'une migration a changé le schéma, ou parce que le
// fichier généré a été édité à la main.
//
// Vérifier : npm run typecheck
//
// Ce fichier ne remplace pas la garde anti-dérive (`npm run types:check`) : celle-ci prouve que
// le fichier versionné correspond à la base, celui-ci prouve que son contenu dit ce que le
// produit attend. Les deux sont nécessaires — un fichier fidèle à un schéma faux passerait la
// première et devrait échouer ici.

import type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from './database.types.js'

// --- Outillage d'assertion ---------------------------------------------------------------------
// `Equal` compare deux types de façon **exacte** : ni l'un ni l'autre ne peut être plus large.
// Une simple contrainte `extends` accepterait `any`, ce qui laisserait passer précisément ce que
// ces types sont censés empêcher.

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type Expect<T extends true> = T

// --- 1. Les tables du socle d'identité, et elles seules -----------------------------------------
// docs/SCHEMA.md §1. Une table ajoutée sans régénération, ou régénérée sans que ce test soit
// étendu, casse ici.
//
// RÉVISÉ PAR `CRM-058`, qui livre `mail_outbox` — la file d'envoi. Le client la LIT (la lecture
// suit la card) et n'y écrit jamais : `queue_outbound_email` est la seule porte.
//
// RÉVISÉ PAR `CRM-078`, qui livre `workflow_versions` — les photographies immuables d'un workflow.
// Le client la LIT et n'y écrit JAMAIS : `publish_workflow_version` est la seule porte, et la mise
// à jour est refusée jusque sous la clé de service (docs/SPEC-workflow-engine.md §7 ter.4). Le
// type généré, lui, expose `Insert` et `Update` comme pour n'importe quelle table : le générateur
// ne lit ni les politiques, ni les privilèges, ni les triggers. C'est la même limite qu'INC-027,
// et elle est nommée ici plutôt que laissée à la surprise du prochain lecteur.

type _tables = Expect<
  Equal<
    keyof Database['public']['Tables'],
    | 'card_comments'
    | 'card_events'
    | 'card_field_values'
    | 'cards'
    | 'channel_members'
    | 'channels'
    | 'form_field_rules'
    | 'form_fields'
    | 'mail_attachments'
    | 'mail_folder_map'
    | 'mail_inbound_accounts'
    | 'mail_message_occurrences'
    | 'mail_messages'
    | 'mail_outbound_identities'
    | 'mail_outbox'
    | 'profiles'
    | 'track_members'
    | 'tracks'
    | 'workflow_nodes_catalog'
    | 'workflow_steps'
    | 'workflow_transition_required_fields'
    | 'workflow_transitions'
    | 'workflow_versions'
    | 'workflows'
    | 'workspace_members'
    | 'workspaces'
  >
>

// --- 2. `profiles` : colonnes, nullabilité, défauts ----------------------------------------------

type _profilesColonnes = Expect<
  Equal<
    keyof Tables<'profiles'>,
    'avatar_url' | 'created_at' | 'full_name' | 'id' | 'locale' | 'updated_at'
  >
>

// `full_name` est `not null` : le type ne doit pas admettre `null`, sans quoi l'interface
// afficherait des noms vides sans que rien ne l'en avertisse (docs/SCHEMA.md §1).
type _fullNameNonNul = Expect<Equal<Tables<'profiles'>['full_name'], string>>

// `avatar_url` est la seule colonne nullable de la table.
type _avatarNullable = Expect<Equal<Tables<'profiles'>['avatar_url'], string | null>>

// À l'insertion, `id` et `full_name` sont exigés ; tout ce qui a un défaut en base est
// facultatif. C'est ce qui distingue `Insert` de `Row`, et ce que la webapp exploitera.
type _insertRequis = Expect<
  Equal<
    { [K in keyof TablesInsert<'profiles'> as {} extends Pick<TablesInsert<'profiles'>, K> ? never : K]: true },
    { full_name: true; id: true }
  >
>

// À la mise à jour, aucune colonne n'est exigée.
type _updateToutFacultatif = Expect<Equal<{} extends TablesUpdate<'profiles'> ? true : false, true>>

// --- 3. `workspaces` : le JSON reste du JSON -----------------------------------------------------
// `settings` est un `jsonb` non nul, de défaut `{}` (docs/SCHEMA.md §1).

type _settingsJson = Expect<Equal<Tables<'workspaces'>['settings'], Json>>
type _inboundNullable = Expect<Equal<Tables<'workspaces'>['inbound_domain'], string | null>>

// --- 4. Limite assumée : une contrainte CHECK ne survit pas à la génération ----------------------
// docs/SPEC-types.md §7. `role` est contraint en base à ('admin', 'business_developer',
// 'viewer'), et le type généré dit `string`. Cette assertion **fige la limite** : le jour où le
// schéma passerait à un type énuméré PostgreSQL, elle échouerait, et la limite documentée devrait
// être révisée dans le même changement plutôt que de survivre à sa cause.

type _roleEstUneChaine = Expect<Equal<Tables<'workspace_members'>['role'], string>>
type _accesTrackEstUneChaine = Expect<Equal<Tables<'track_members'>['access'], string>>
type _accesChannelEstUneChaine = Expect<Equal<Tables<'channel_members'>['access'], string>>

// Corollaire, énoncé pour qu'il ne soit pas déduit à tort : le type **n'exclut pas** une valeur
// hors vocabulaire. Seule la base la refuse.
type _roleNEstPasLUnion = Expect<
  Equal<Equal<Tables<'workspace_members'>['role'], 'admin' | 'business_developer' | 'viewer'>, false>
>

// --- 5. INC-010 : les deux moitiés sont closes --------------------------------------------------
// L'assertion sur `track_members` affirmait l'absence de clé étrangère vers `tracks`, « ce qui
// fera échouer cette assertion à CRM-020, et c'est le signal voulu ». Le signal s'est produit :
// elle a **réellement échoué** à la livraison de `CRM-020`, et elle a été révisée.
// Celle de `channel_members` a échoué à son tour à la livraison de `CRM-021`, et est révisée ici.
// Les deux signaux ont fonctionné, à un chunk d'intervalle.

type _relationsTrackMembers = Expect<
  Equal<
    Database['public']['Tables']['track_members']['Relationships'][number]['foreignKeyName'],
    'track_members_track_id_fkey' | 'track_members_user_id_fkey'
  >
>

type _relationsChannelMembers = Expect<
  Equal<
    Database['public']['Tables']['channel_members']['Relationships'][number]['foreignKeyName'],
    'channel_members_channel_id_fkey' | 'channel_members_user_id_fkey'
  >
>

// --- 5 bis. `channels` : le cloisonnement est **composite**, et INC-029 est visible dans le type -
// `CRM-021`. La clé étrangère de `channels` porte sur le couple `(track_id, workspace_id)` et non
// sur `track_id` seul : c'est elle qui empêche le `workspace_id` dénormalisé de mentir à la RLS
// (docs/SPEC-channels.md §2.4). Aucune clé simple sur `track_id` ne doit apparaître ici.

type _relationsChannels = Expect<
  Equal<
    Database['public']['Tables']['channels']['Relationships'][number]['foreignKeyName'],
    // RÉVISÉ PAR `CRM-077` (décision 398) : la corbeille ajoute `deleted_by`, dont la clé étrangère
    // vers `profiles` apparaît ici comme toute autre. Le cloisonnement composite décrit ci-dessus
    // est INCHANGÉ — aucune clé simple sur `track_id` n'apparaît, et c'est ce que l'assertion garde.
    | 'channels_deleted_by_fkey'
    | 'channels_track_id_workspace_id_fkey'
    | 'channels_workflow_id_workspace_id_fkey'
    | 'channels_workspace_id_fkey'
  >
>

// INC-029 EST SOLDÉE PAR `CRM-033`, ET L'ASSERTION EST RÉVISÉE, NON SUPPRIMÉE. Elle constatait la
// colonne **nullable** et annonçait qu'elle deviendrait rouge le jour où la contrainte `NOT NULL`
// serait posée. Ce jour est venu : `docs/SCHEMA.md` §2 est enfin tenu à la lettre, la clé étrangère
// composite est visible ci-dessus, et le type le dit — troisième occurrence du mécanisme de la
// décision 51 sur ce seul fichier.
type _workflowIdObligatoire = Expect<
  Equal<Database['public']['Tables']['channels']['Row']['workflow_id'], string>
>

// INC-027 se reproduit à l'identique sur `channels` : `position` est renseignée par un trigger,
// que le générateur ignore, et le type l'exige donc à l'insertion alors que l'API l'accepte omise.
// Le constat est figé plutôt que corrigé — le fichier est **généré**, et le retoucher ferait
// échouer la garde anti-dérive de `CRM-006`.
//
// `workflow_id` rejoint la liste avec `CRM-033`, mais pour une **autre** raison, et il faut les
// distinguer : elle y figure parce que la colonne est réellement obligatoire, non parce que le
// générateur ignore un trigger. Le type dit ici la vérité du produit.
type _channelsInsertRequis = Expect<
  Equal<
    {
      [C in keyof Database['public']['Tables']['channels']['Insert'] as Record<string, never> extends
        Pick<Database['public']['Tables']['channels']['Insert'], C>
        ? never
        : C]: true
    },
    {
      name: true
      position: true
      slug: true
      track_id: true
      workflow_id: true
      workspace_id: true
    }
  >
>

// --- 5 quater. `workflows`, `workflow_steps`, `workflow_transitions`, livrées par `CRM-031` -----
// docs/SPEC-workflow-engine.md §3.2 à §3.4. Les colonnes sont figées comme celles du catalogue
// l'ont été : une migration qui en ajouterait ou en retirerait une sans régénérer les types casse
// ici, avant d'atteindre le produit.

type _workflowsColonnes = Expect<
  Equal<
    keyof Database['public']['Tables']['workflows']['Row'],
    | 'archived_at'
    | 'created_at'
    | 'derived_at'
    | 'derived_from_workflow_id'
    | 'id'
    | 'is_default'
    | 'name'
    | 'scope'
    | 'source_composition_fingerprint'
    | 'track_id'
    | 'updated_at'
    | 'workspace_id'
  >
>

type _etapesColonnes = Expect<
  Equal<
    keyof Database['public']['Tables']['workflow_steps']['Row'],
    | 'created_at'
    | 'id'
    | 'is_initial'
    | 'label_override'
    | 'node_id'
    | 'position'
    | 'probability_override'
    | 'stale_after_days'
    | 'updated_at'
    | 'workflow_id'
    | 'workspace_id'
  >
>

type _transitionsColonnes = Expect<
  Equal<
    keyof Database['public']['Tables']['workflow_transitions']['Row'],
    | 'created_at'
    | 'from_step_id'
    | 'id'
    | 'label'
    | 'require_comment'
    | 'to_step_id'
    | 'updated_at'
    | 'workflow_id'
    | 'workspace_id'
  >
>

// `scope` est un `text` avec contrainte `CHECK`, non un type énuméré : le générateur ne peut donc
// pas en faire une union. La limite est **figée**, comme elle l'est pour `role`, `color` et `kind`
// (INC-006 du §5 ter) : le client qui affiche un workflow ne tient pas la vérité de ce champ.
type _scopeEstUneChaine = Expect<
  Equal<Database['public']['Tables']['workflows']['Row']['scope'], string>
>

// Les surcharges d'une étape sont nullables, et `null` signifie « prendre la valeur du catalogue »
// — jamais zéro (docs/SPEC-workflow-engine.md §3.3).
type _surchargesNullables = Expect<
  Equal<Database['public']['Tables']['workflow_steps']['Row']['label_override'], string | null> &
    Equal<
      Database['public']['Tables']['workflow_steps']['Row']['probability_override'],
      number | null
    >
>

// INC-033 EST CORRIGÉE PAR `CRM-018` : le type expose une relation exacte à deux colonnes, là où
// l'ancien tableau ne pouvait porter aucune clé étrangère.
type _liaisonsChampsExigesColonnes = Expect<
  Equal<keyof Tables<'workflow_transition_required_fields'>, 'field_id' | 'transition_id'>
>

type _relationsLiaisonsChampsExiges = Expect<
  Equal<
    Database['public']['Tables']['workflow_transition_required_fields']['Relationships'][number]['foreignKeyName'],
    | 'workflow_transition_required_fields_field_id_fkey'
    | 'workflow_transition_required_fields_transition_id_fkey'
  >
>

// Les clés étrangères des transitions sont **composites** : c'est ce qui empêche une arête de
// sortir de son workflow (décision 73). Aucune clé simple sur `from_step_id` ou `to_step_id`.
type _relationsTransitions = Expect<
  Equal<
    Database['public']['Tables']['workflow_transitions']['Relationships'][number]['foreignKeyName'],
    | 'workflow_transitions_from_step_fkey'
    | 'workflow_transitions_to_step_fkey'
    | 'workflow_transitions_workflow_id_workspace_id_fkey'
  >
>

// INC-027, QUATRIÈME OCCURRENCE : `position` est renseignée par un trigger, que le générateur
// ignore, et le type l'exige donc à l'insertion alors que l'API l'accepte omise. Le constat est
// figé plutôt que corrigé — le fichier est **généré**.
type _etapesInsertRequis = Expect<
  Equal<
    {
      [C in keyof Database['public']['Tables']['workflow_steps']['Insert'] as Record<
        string,
        never
      > extends Pick<Database['public']['Tables']['workflow_steps']['Insert'], C>
        ? never
        : C]: true
    },
    { node_id: true; position: true; workflow_id: true; workspace_id: true }
  >
>

// --- 5 quater. `form_fields` et `form_field_rules`, livrées par `CRM-035` ------------------------
// docs/SCHEMA.md §4, docs/SPEC-form-composer.md §2.2 et §3.2.

type _champsColonnes = Expect<
  Equal<
    keyof Tables<'form_fields'>,
    | 'archived_at'
    | 'created_at'
    | 'help_text'
    | 'id'
    | 'key'
    | 'label'
    | 'options'
    | 'position'
    | 'type'
    | 'updated_at'
    | 'workflow_id'
    | 'workspace_id'
  >
>

type _reglesColonnes = Expect<
  Equal<
    keyof Tables<'form_field_rules'>,
    | 'created_at'
    | 'field_id'
    | 'step_id'
    | 'updated_at'
    | 'visibility'
    | 'workflow_id'
    | 'workspace_id'
  >
>

// --- 5 quinquies. `card_field_values`, livrée par `CRM-036` --------------------------------------
// docs/SCHEMA.md §4, docs/SPEC-form-composer.md §6.2.

type _valeursColonnes = Expect<
  Equal<
    keyof Tables<'card_field_values'>,
    | 'card_id'
    | 'created_at'
    | 'field_id'
    | 'updated_at'
    | 'updated_by'
    | 'value'
    | 'workflow_id'
    | 'workspace_id'
  >
>

// `value` est NULLABLE côté type, et ce n'est pas un relâchement : PostgREST convertit un `null`
// JSON en SQL NULL et ne sait produire `'null'::jsonb` par aucune écriture, si bien qu'une colonne
// `NOT NULL` rendait un champ `money` impossible à vider (INC-054, décision 133). Le type porte
// donc exactement ce que la base tient, et un client qui écrit `null` vide bien le champ.
type _valeurNullable = Expect<Equal<Tables<'card_field_values'>['value'], Json | null>>

// Les deux clés étrangères COMPOSITES sont visibles dans les types : c'est ce qui rend structurelle
// la garantie « une valeur ne répond pas à la question d'un autre workflow » (§6.3, décision 124).
type _relationsValeurs = Expect<
  Equal<
    Database['public']['Tables']['card_field_values']['Relationships'][0]['columns'],
    ['card_id', 'workflow_id']
  >
>

// `type` et `visibility` sont des `text` avec contrainte `CHECK`, non des types énumérés : le
// générateur ne peut pas en faire des unions. La limite est **figée**, comme pour `role`, `color`,
// `kind` et `scope`. Un client qui rend un formulaire ne tient pas la vérité de ces champs depuis
// le type : elle est dans `docs/SPEC-form-composer.md` §2.3 et §3.1.
type _typeChampEstUneChaine = Expect<
  Equal<Database['public']['Tables']['form_fields']['Row']['type'], string>
>
type _visibiliteEstUneChaine = Expect<
  Equal<Database['public']['Tables']['form_field_rules']['Row']['visibility'], string>
>

// `options` est un `jsonb` : le générateur en fait `Json`, qui est une union récursive. Le type ne
// dit donc **rien** de la présence de `choices` ni de `currency`, que les contraintes de la base
// exigent pourtant (décision 94). Constat figé : la vérité est côté base, pas côté type.
type _optionsEstDuJson = Expect<
  Equal<Database['public']['Tables']['form_fields']['Row']['options'], Json>
>

// Les clés étrangères des règles sont **composites** : c'est ce qui rend impossible une règle
// croisant deux workflows (décision 95). Aucune clé simple sur `field_id` ni sur `step_id`.
type _relationsRegles = Expect<
  Equal<
    Database['public']['Tables']['form_field_rules']['Relationships'][number]['foreignKeyName'],
    | 'form_field_rules_field_id_workflow_id_fkey'
    | 'form_field_rules_step_id_workflow_id_fkey'
    | 'form_field_rules_workflow_id_workspace_id_fkey'
  >
>

// INC-027, CINQUIÈME OCCURRENCE : `position` est renseignée par un trigger, que le générateur
// ignore, et le type l'exige donc à l'insertion alors que l'API l'accepte omise.
type _champsInsertRequis = Expect<
  Equal<
    {
      [C in keyof Database['public']['Tables']['form_fields']['Insert'] as Record<
        string,
        never
      > extends Pick<Database['public']['Tables']['form_fields']['Insert'], C>
        ? never
        : C]: true
    },
    { key: true; label: true; position: true; type: true; workflow_id: true; workspace_id: true }
  >
>

// --- 5 ter. `workflow_nodes_catalog`, livrée par `CRM-030` ---------------------------------------
// docs/SCHEMA.md §3, docs/SPEC-workflow-engine.md §2.2.

type _catalogueColonnes = Expect<
  Equal<
    keyof Tables<'workflow_nodes_catalog'>,
    | 'archived_at'
    | 'color'
    | 'created_at'
    | 'default_probability'
    | 'default_stale_after_days'
    | 'id'
    | 'key'
    | 'kind'
    | 'label'
    | 'position'
    | 'updated_at'
    | 'workspace_id'
  >
>

// Les deux valeurs par défaut sont **nullables** dans le type parce qu'elles le sont en base, et
// c'est voulu : `0` n'est pas `NULL`. « Perdu à coup sûr » et « aucune signification
// prévisionnelle » sont deux états différents (docs/SPEC-workflow-engine.md §2.5).
type _probabiliteNullable = Expect<
  Equal<Tables<'workflow_nodes_catalog'>['default_probability'], number | null>
>
type _seuilNullable = Expect<
  Equal<Tables<'workflow_nodes_catalog'>['default_stale_after_days'], number | null>
>

// `kind` et `color` restent des `string` : ce sont des colonnes `text` avec contrainte `CHECK`, que
// le générateur ne lit pas. Même limite que `tracks.color` et `workspace_members.role`, figée par
// une assertion plutôt que déplorée dans un commentaire (INC-020, `CRM-006`).
type _kindEstUneChaine = Expect<Equal<Tables<'workflow_nodes_catalog'>['kind'], string>>
type _couleurCatalogueEstUneChaine = Expect<
  Equal<Tables<'workflow_nodes_catalog'>['color'], string>
>

// Le catalogue ne porte qu'une seule clé étrangère : son workspace. Il n'a pas de parent
// intermédiaire, ce qui est précisément pourquoi sa dénormalisation ne peut pas mentir, à la
// différence de `channels` (docs/SPEC-workflow-engine.md §2.2).
type _relationsCatalogue = Expect<
  Equal<
    Database['public']['Tables']['workflow_nodes_catalog']['Relationships'][number]['foreignKeyName'],
    'workflow_nodes_catalog_workspace_id_fkey'
  >
>

// INC-027 se reproduit une troisième fois : `position` est renseignée par un trigger, que le
// générateur ignore, et le type l'exige donc à l'insertion alors que l'API l'accepte omise —
// mesuré ligne m du §2.8. Le constat est figé plutôt que corrigé : le fichier est **généré**.
type _catalogueInsertRequis = Expect<
  Equal<
    {
      [K in keyof TablesInsert<'workflow_nodes_catalog'> as {} extends Pick<
        TablesInsert<'workflow_nodes_catalog'>,
        K
      >
        ? never
        : K]: true
    },
    { key: true; label: true; position: true; workspace_id: true }
  >
>

// `workspace_members` porte au contraire ses deux clés étrangères.
type _relationsWorkspaceMembers = Expect<
  Equal<
    Database['public']['Tables']['workspace_members']['Relationships'][number]['foreignKeyName'],
    'workspace_members_user_id_fkey' | 'workspace_members_workspace_id_fkey'
  >
>

// --- 5 bis. `tracks`, livrée par `CRM-020` -------------------------------------------------------
// docs/SCHEMA.md §2, docs/SPEC-tracks.md §2.1.

type _tracksColonnes = Expect<
  Equal<
    keyof Tables<'tracks'>,
    // RÉVISÉ PAR `CRM-077` (décision 398) : `deleted_at` et `deleted_by` s'ajoutent, et
    // `docs/SPEC-tracks.md` §2.1 les porte dans le même changement. La règle prouvée est
    // inchangée : le type liste EXACTEMENT les colonnes de la spécification.
    | 'archived_at'
    | 'color'
    | 'deleted_at'
    | 'deleted_by'
    | 'created_at'
    | 'description'
    | 'icon'
    | 'id'
    | 'name'
    | 'position'
    | 'slug'
    | 'updated_at'
    | 'workspace_id'
  >
>

// `archived_at` nul signifie « actif » : c'est la seule colonne de la table dont la nullabilité
// porte une règle métier (docs/SPEC-tracks.md §4).
type _archivedAtNullable = Expect<Equal<Tables<'tracks'>['archived_at'], string | null>>

// `color` et `icon` sont des `string`, pas des unions. Les contraintes `CHECK` de la migration
// ne remontent pas dans les types : docs/SPEC-types.md pose que le générateur décrit le
// **stockage**, jamais la règle. Croire le type, ici, reviendrait à croire qu'une valeur
// inattendue est impossible — ce que `webapp/src/app/presentation-tracks.ts` traite par un repli.
type _colorEstUneChaine = Expect<Equal<Tables<'tracks'>['color'], string>>
type _iconEstUneChaine = Expect<Equal<Tables<'tracks'>['icon'], string>>

// LIMITE FIGÉE PAR UNE ASSERTION (docs/JOURNAL.md décision 51).
//
// `position` est **exigée à l'insertion** par le type généré, alors que le trigger
// `app.tracks_attribuer_position` la rend facultative : le générateur ne lit que le défaut de
// colonne, et un trigger lui est invisible. Le type est donc plus strict que le produit.
//
// L'écart est constaté ici plutôt que corrigé à la main : `webapp/src/lib/database.types.ts` est
// un fichier **généré**, et le retoucher ferait échouer la garde anti-dérive de `CRM-006`.
// Conséquence pratique : un client TypeScript devra fournir `position`, ou passer par un cast.
// Consigné en docs/INCONSISTENCY_REPORT.md, INC-027.
type _tracksInsertRequis = Expect<
  Equal<
    { [K in keyof TablesInsert<'tracks'> as {} extends Pick<TablesInsert<'tracks'>, K> ? never : K]: true },
    { name: true; position: true; slug: true; workspace_id: true }
  >
>

// --- 6. La vue et la fonction de `CRM-032` -------------------------------------------------------
// RÉVISÉ PAR `CRM-032` (mécanisme de la décision 51). Ces deux assertions disaient « aucune vue,
// aucune fonction appelable en RPC », et c'était exact jusqu'ici : les fonctions du produit vivent
// dans le schéma `app`, que PostgREST n'expose pas (docs/SPEC-types.md §3).
//
// `CRM-032` livre les deux premiers objets appelables de `public` : la RPC de copie et la vue de
// divergence (docs/SPEC-workflow-engine.md §4.2, §4.6). Les assertions sont donc **resserrées sur
// ce qui est livré**, et non supprimées : une vue ou une fonction de plus les rendrait rouges.

type _laSeuleVue = Expect<Equal<keyof Database['public']['Views'], 'workflow_derivations'>>

type _vueDerivationColonnes = Expect<
  Equal<
    keyof Database['public']['Views']['workflow_derivations']['Row'],
    | 'current_source_composition_fingerprint'
    | 'derived_at'
    | 'name'
    | 'source_archived_at'
    | 'source_composition_fingerprint'
    | 'source_modified_at'
    | 'source_modified_since_copy'
    | 'source_name'
    | 'source_workflow_id'
    | 'track_id'
    | 'workflow_id'
    | 'workspace_id'
  >
>

// RÉVISÉ UNE SECONDE FOIS PAR `CRM-034` (mécanisme de la décision 51, et l'assertion avait bien
// annoncé le moment : « une fonction de plus les rendrait rouges »). `move_card` est la deuxième
// fonction appelable de `public` (docs/SPEC-workflow-engine.md §5.2).
//
// RÉVISÉ UNE TROISIÈME FOIS PAR `CRM-045`, puis une quatrième par `CRM-019` : l'annonce s'est
// encore vérifiée. `change_channel_workflow` est la quatrième fonction appelable.
//
// RÉVISÉ UNE CINQUIÈME FOIS PAR `CRM-052`, et l'annonce « une cinquième la rendra rouge à son
// tour » s'est vérifiée telle quelle — septième occurrence du mécanisme de la décision 51. Les
// TROIS fonctions ajoutées vivent dans `public` parce que PostgREST n'expose que ce schéma
// (docs/SPEC-mail-subsystem.md §13.3) ; deux d'entre elles sont pourtant **inaccessibles au
// client**, leur exécution étant réservée à `service_role`. Le type les voit, la base les refuse :
// c'est la différence entre ce qui est déclaré et ce qui est consenti, et elle est mesurée par
// `e2e/api/comptes-entrants.spec.ts`.
//
// RÉVISÉ UNE SEPTIÈME FOIS PAR `CRM-055`, qui livre les deux fonctions de classement — dont une
// seule est appelable par le client, l'autre étant un constat de la relève.
//
// RÉVISÉ UNE SIXIÈME FOIS PAR `CRM-053`, qui livre les trois fonctions jumelles des sortantes.
// Même remarque : deux d'entre elles sont **inaccessibles au client**, leur exécution étant
// réservée à `service_role`.
//
// RÉVISÉ UNE HUITIÈME FOIS PAR `CRM-057` — ET LA RÉVISION EN RATTRAPE UNE AUTRE, OMISE. `CRM-056`
// avait livré `chemin_dossier_entite` et `mail_folder_map_reparenter` **sans régénérer les types**
// versionnés : cette assertion serait donc devenue rouge dès la régénération suivante, exactement
// comme elle est faite pour le faire. Elle a joué, avec un chunk de retard, et le retard est nommé
// plutôt que corrigé en silence — `scripts/verify-types.sh` mesure cet écart, mais il n'appartient
// pas au harnais global de `CRM-008`, qui ne l'exécute pas.
//
// `CRM-057` ajoute `inbox_arborescence`, **appelable par le client** — contrairement aux deux
// précédentes, réservées à `service_role`. C'est la première fonction de messagerie qu'un écran
// appelle vraiment.
// RÉVISÉ UNE NEUVIÈME FOIS PAR `CRM-058`, qui livre quatre fonctions d'envoi. UNE SEULE est
// appelable par le client — `queue_outbound_email` : les trois autres sont le fait du worker et
// réservées à `service_role`. Le type les voit, la base les refuse.
// RÉVISÉ UNE DIXIÈME FOIS PAR `CRM-059`, qui livre trois fonctions de résilience. Une seule est
// appelable par le client — `etat_messagerie`, qui montre l'état RÉEL ; les deux autres sont le
// fait du worker.
//
// RÉVISÉ UNE ONZIÈME FOIS LE 2026-08-14, ET LE RETARD EST DE NOUVEAU NOMMÉ PLUTÔT QUE TU. La
// reprise d'INC-072 (`CRM-043`, décision 376) avait besoin de `card_comments.deleted_by` dans les
// types versionnés : la migration `0035` l'a créée sans les régénérer, et le compilateur refusait
// la colonne dans le `select` du fil. MESURÉ AVANT TOUTE MODIFICATION — `npm run types:check` est
// rouge **sur la ligne de base**, et l'écart porte sur QUATRE sources, dont trois étrangères à
// cette unité : `mail_messages.filed_at`, la colonne `attempts` du retour de `reserver_envois`, et
// les deux fonctions ci-dessous. Régénérer est le seul geste honnête sur un fichier ENGENDRÉ — le
// corriger à la main pour la seule colonne due l'aurait laissé dans un état qu'aucun générateur ne
// produit —, et cette assertion a joué exactement comme elle est faite pour le faire.
//
// Les deux nouvelles sont le fait du RANGEMENT, et **aucune n'est appelable par le client** :
// `messages_a_ranger` et `marquer_message_range` sont réservées au worker `mail-sync`, comme
// `dossiers_a_renommer`. Le type les voit, la base les refuse — c'est la limite que ce bloc
// répète depuis la première révision. Le nom du type suit le compte : vingt-six.
//
// RÉVISÉ UNE DOUZIÈME FOIS PAR `CRM-076`, sixième tranche (décision 390). L'assertion est devenue
// rouge parce que la RÈGLE a changé : la migration `0036` ajoute `previsualiser_exigence`, et
// c'est la SECONDE fonction de ce fichier réellement appelable par un écran sans être réservée au
// worker. Elle est ajoutée, non contournée, et une propriété la distingue des vingt-six autres :
// elle est `SECURITY INVOKER`, si bien que le nombre qu'elle rend est borné par la RLS de son
// appelant (docs/SPEC-workflow-engine.md §7 bis.13.2). Vingt-six devient vingt-sept.
//
// RÉVISÉ UNE TREIZIÈME FOIS PAR `CRM-078`, première tranche. La règle a changé de nouveau : la
// migration `0039` ajoute `publish_workflow_version`, TROISIÈME fonction de ce fichier réellement
// appelable par un écran sans être réservée au worker — même si l'écran, lui, ne viendra qu'à la
// cinquième tranche. Elle est `SECURITY DEFINER` et vérifie donc le rôle elle-même, à la
// différence de `previsualiser_exigence`. Vingt-sept devient vingt-huit.
//
// RÉVISÉ UNE QUATORZIÈME FOIS PAR `CRM-078`, deuxième tranche. La règle a changé de nouveau : la
// migration `0040` ajoute `compare_workflow_versions`, QUATRIÈME fonction de ce fichier appelable
// par un écran sans être réservée au worker. Elle est `SECURITY INVOKER` comme
// `previsualiser_exigence`, et c'est un choix documenté : la politique de lecture de
// `workflow_versions` est déjà la règle d'autorisation exacte du geste
// (docs/SPEC-workflow-engine.md §7 ter.11.3). Vingt-huit devient vingt-neuf.
type _lesVingtNeufFonctions = Expect<
  Equal<
    keyof Database['public']['Functions'],
    | 'change_channel_workflow'
    | 'compare_workflow_versions'
    | 'copy_workflow_to_track'
    | 'chemin_dossier_card'
    | 'chemin_dossier_entite'
    | 'classer_message_automatiquement'
    | 'classify_message'
    | 'dossiers_a_renommer'
    | 'etat_messagerie'
    | 'inbox_arborescence'
    | 'marquer_envoi_echoue'
    | 'marquer_envoi_reussi'
    | 'mail_folder_map_reparenter'
    | 'mail_inbound_account_credentials'
    | 'mail_inbound_account_record_check'
    | 'marquer_message_range'
    | 'messages_a_ranger'
    | 'mail_outbound_identity_credentials'
    | 'mail_outbound_identity_record_check'
    | 'move_card'
    | 'publish_workflow_version'
    | 'move_card_to_channel'
    | 'previsualiser_exigence'
    | 'queue_outbound_email'
    | 'reprendre_envois_orphelins'
    | 'reprogrammer_envoi'
    | 'reserver_envois'
    | 'upsert_mail_inbound_account'
    | 'upsert_mail_outbound_identity'
  >
>

// L'arborescence de l'inbox ne prend AUCUN argument, et c'est le contrat : elle rend ce que
// l'appelant voit, jamais ce qu'on lui demande de voir (docs/SPEC-mail-subsystem.md §18.3).
type _signatureArborescence = Expect<
  Equal<Database['public']['Functions']['inbox_arborescence']['Args'], never>
>

// La signature exposée au client TypeScript est celle du contrat d'API : `new_name` facultatif,
// les deux autres exigés, et un `uuid` en retour (docs/SPEC-workflow-engine.md §4.2).
type _signatureCopie = Expect<
  Equal<
    Database['public']['Functions']['copy_workflow_to_track']['Args'],
    { new_name?: string; track_id: string; workflow_id: string }
  >
>
type _retourCopie = Expect<
  Equal<Database['public']['Functions']['copy_workflow_to_track']['Returns'], string>
>

// La signature de `move_card` exposée au client TypeScript est celle du contrat du §5.2 :
// `comment` facultatif, les deux identifiants exigés.
type _signatureDeplacement = Expect<
  Equal<
    Database['public']['Functions']['move_card']['Args'],
    { card_id: string; comment?: string; to_step_id: string }
  >
>

// LE RETOUR EST LA LIGNE, ET LE TYPE GÉNÉRÉ LE CONFIRME : `move_card` rend un objet portant les
// colonnes de `cards`, non un `void` ni un tableau. C'est ce qui permet au client d'obtenir
// l'étape, `entered_step_at` et `position` recalculés SANS relecture — relecture qu'une politique
// pourrait, entre-temps, refuser (docs/SPEC-workflow-engine.md §5.2).
type _retourDeplacementEstUnObjet = Expect<
  Equal<Database['public']['Functions']['move_card']['Returns'] extends unknown[] ? true : false, false>
>
type _retourDeplacementPorteLEtape = Expect<
  Equal<Database['public']['Functions']['move_card']['Returns']['current_step_id'], string>
>
type _retourDeplacementPorteLInstant = Expect<
  Equal<Database['public']['Functions']['move_card']['Returns']['entered_step_at'], string>
>

// La signature de `move_card_to_channel` est celle du contrat du §6.2 : `to_step_id` et
// `discard_field_values` FACULTATIFS, les deux identifiants exigés. Le caractère facultatif du
// troisième paramètre est une propriété du produit et non un détail de génération — « si le
// workflow cible est identique, l'étape est conservée par défaut » (§6.4).
type _signatureChangementDeChannel = Expect<
  Equal<
    Database['public']['Functions']['move_card_to_channel']['Args'],
    { card_id: string; discard_field_values?: boolean; to_channel_id: string; to_step_id?: string }
  >
>

// LE RETOUR EST LA LIGNE, comme pour `move_card` et pour le même motif mesuré : le client obtient
// le channel, le workflow, l'étape et `position` recalculés SANS relecture (§6.2).
type _retourChangementEstUnObjet = Expect<
  Equal<
    Database['public']['Functions']['move_card_to_channel']['Returns'] extends unknown[]
      ? true
      : false,
    false
  >
>
type _retourChangementPorteLeChannel = Expect<
  Equal<Database['public']['Functions']['move_card_to_channel']['Returns']['channel_id'], string>
>
type _retourChangementPorteLeWorkflow = Expect<
  Equal<Database['public']['Functions']['move_card_to_channel']['Returns']['workflow_id'], string>
>

// `CRM-019` rend le lot entier : trois arguments exigés, l'opt-in destructif facultatif, JSON
// non inventé par le client et tableau de cards en retour (docs/SPEC-change-channel-workflow.md).
type _signatureChangementWorkflowChannel = Expect<
  Equal<
    Database['public']['Functions']['change_channel_workflow']['Args'],
    {
      channel_id: string
      discard_field_values?: boolean
      step_mapping: Json
      workflow_id: string
    }
  >
>
type _retourChangementWorkflowEstUnLot = Expect<
  Equal<
    Database['public']['Functions']['change_channel_workflow']['Returns'] extends unknown[]
      ? true
      : false,
    true
  >
>
type _retourChangementWorkflowPorteLEtape = Expect<
  Equal<
    Database['public']['Functions']['change_channel_workflow']['Returns'][number]['current_step_id'],
    string
  >
>

// Toutes les colonnes d'une vue sont nullables du point de vue du générateur : PostgreSQL ne porte
// aucune contrainte `NOT NULL` sur une vue, et le fait est **constaté** plutôt que contourné. Un
// client qui lit `source_modified_since_copy` doit donc traiter le cas nul, alors que la vue ne
// peut pas en produire — quatrième occurrence du même écart entre le schéma réel et son type
// généré (INC-027).
type _vueToutNullable = Expect<
  Equal<
    Database['public']['Views']['workflow_derivations']['Row']['source_modified_since_copy'],
    boolean | null
  >
>

type _aucunEnum = Expect<Equal<keyof Database['public']['Enums'], never>>
type _aucunTypeCompose = Expect<Equal<keyof Database['public']['CompositeTypes'], never>>

// --- 7. Le fichier reste utilisable comme module -------------------------------------------------
// `isolatedModules` exige que les types déclarés ici soient consommés ; cet export unique évite
// des déclarations « inutilisées » sans relâcher aucune vérification.

export type AssertionsDuContratDeTypes = [
  _tables,
  _profilesColonnes,
  _fullNameNonNul,
  _avatarNullable,
  _insertRequis,
  _updateToutFacultatif,
  _settingsJson,
  _inboundNullable,
  _roleEstUneChaine,
  _accesTrackEstUneChaine,
  _accesChannelEstUneChaine,
  _roleNEstPasLUnion,
  _tracksColonnes,
  _archivedAtNullable,
  _colorEstUneChaine,
  _iconEstUneChaine,
  _tracksInsertRequis,
  _relationsTrackMembers,
  _relationsChannelMembers,
  _relationsChannels,
  _workflowIdObligatoire,
  _channelsInsertRequis,
  _champsColonnes,
  _reglesColonnes,
  _typeChampEstUneChaine,
  _visibiliteEstUneChaine,
  _valeursColonnes,
  _valeurNullable,
  _relationsValeurs,
  _optionsEstDuJson,
  _relationsRegles,
  _champsInsertRequis,
  _catalogueColonnes,
  _probabiliteNullable,
  _seuilNullable,
  _kindEstUneChaine,
  _couleurCatalogueEstUneChaine,
  _relationsCatalogue,
  _catalogueInsertRequis,
  _workflowsColonnes,
  _etapesColonnes,
  _transitionsColonnes,
  _scopeEstUneChaine,
  _surchargesNullables,
  _liaisonsChampsExigesColonnes,
  _relationsLiaisonsChampsExiges,
  _relationsTransitions,
  _etapesInsertRequis,
  _relationsWorkspaceMembers,
  _laSeuleVue,
  _vueDerivationColonnes,
  _lesVingtNeufFonctions,
  _signatureArborescence,
  _signatureCopie,
  _retourCopie,
  _signatureDeplacement,
  _retourDeplacementEstUnObjet,
  _retourDeplacementPorteLEtape,
  _retourDeplacementPorteLInstant,
  _signatureChangementDeChannel,
  _retourChangementEstUnObjet,
  _retourChangementPorteLeChannel,
  _retourChangementPorteLeWorkflow,
  _signatureChangementWorkflowChannel,
  _retourChangementWorkflowEstUnLot,
  _retourChangementWorkflowPorteLEtape,
  _vueToutNullable,
  _aucunEnum,
  _aucunTypeCompose,
]
