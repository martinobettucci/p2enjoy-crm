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

type _tables = Expect<
  Equal<
    keyof Database['public']['Tables'],
    | 'channel_members'
    | 'channels'
    | 'profiles'
    | 'track_members'
    | 'tracks'
    | 'workflow_nodes_catalog'
    | 'workflow_steps'
    | 'workflow_transitions'
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
    | 'channels_track_id_workspace_id_fkey'
    | 'channels_workflow_id_workspace_id_fkey'
    | 'channels_workspace_id_fkey'
  >
>

// INC-029, FIGÉE DANS LE TYPE, ET RÉVISÉE PAR `CRM-031`. La clé étrangère existe désormais — elle
// est **composite**, et visible ci-dessus. La colonne, elle, reste nullable : `docs/SCHEMA.md` §2
// l'exige non nulle, et cette contrainte revient à `CRM-033` avec le contrat de création d'un
// channel qu'elle modifie. L'assertion deviendra rouge ce jour-là.
type _workflowIdNullable = Expect<
  Equal<Database['public']['Tables']['channels']['Row']['workflow_id'], string | null>
>

// INC-027 se reproduit à l'identique sur `channels` : `position` est renseignée par un trigger,
// que le générateur ignore, et le type l'exige donc à l'insertion alors que l'API l'accepte omise.
// Le constat est figé plutôt que corrigé — le fichier est **généré**, et le retoucher ferait
// échouer la garde anti-dérive de `CRM-006`.
type _channelsInsertRequis = Expect<
  Equal<
    {
      [C in keyof Database['public']['Tables']['channels']['Insert'] as Record<string, never> extends
        Pick<Database['public']['Tables']['channels']['Insert'], C>
        ? never
        : C]: true
    },
    { name: true; position: true; slug: true; track_id: true; workspace_id: true }
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
    | 'require_fields'
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

// INC-033, FIGÉE DANS LE TYPE : `require_fields` est un tableau de chaînes, sans la moindre
// relation. Aucune clé étrangère n'est possible depuis une colonne tableau — le type le montre
// aussi clairement que la base.
type _requireFieldsSansRelation = Expect<
  Equal<Database['public']['Tables']['workflow_transitions']['Row']['require_fields'], string[]>
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
    | 'archived_at'
    | 'color'
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
type _laSeuleFonction = Expect<
  Equal<keyof Database['public']['Functions'], 'copy_workflow_to_track'>
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
  _workflowIdNullable,
  _channelsInsertRequis,
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
  _requireFieldsSansRelation,
  _relationsTransitions,
  _etapesInsertRequis,
  _relationsWorkspaceMembers,
  _laSeuleVue,
  _laSeuleFonction,
  _signatureCopie,
  _retourCopie,
  _vueToutNullable,
  _aucunEnum,
  _aucunTypeCompose,
]
