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
    | 'profiles'
    | 'track_members'
    | 'tracks'
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

// --- 5. INC-010 : une moitié close par `CRM-020`, l'autre encore ouverte -------------------------
// L'assertion sur `track_members` affirmait l'absence de clé étrangère vers `tracks`, « ce qui
// fera échouer cette assertion à CRM-020, et c'est le signal voulu ». Le signal s'est produit :
// elle a **réellement échoué** à la livraison de `CRM-020`, et elle est révisée ici.
// `channel_members` garde la sienne : `channels` arrive avec `CRM-021`.

type _relationsTrackMembers = Expect<
  Equal<
    Database['public']['Tables']['track_members']['Relationships'][number]['foreignKeyName'],
    'track_members_track_id_fkey' | 'track_members_user_id_fkey'
  >
>

type _relationsChannelMembers = Expect<
  Equal<
    Database['public']['Tables']['channel_members']['Relationships'][number]['foreignKeyName'],
    'channel_members_user_id_fkey'
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

// --- 6. Ce que le schéma n'expose pas encore -----------------------------------------------------
// Aucune vue, aucune fonction appelable en RPC, aucun type énuméré. Les fonctions de `CRM-010`
// vivent dans le schéma `app`, que PostgREST n'expose pas (docs/SPEC-types.md §3) : leur absence
// ici est **exacte**, et non un oubli de génération.

type _aucuneVue = Expect<Equal<keyof Database['public']['Views'], never>>
type _aucuneFonction = Expect<Equal<keyof Database['public']['Functions'], never>>
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
  _relationsWorkspaceMembers,
  _aucuneVue,
  _aucuneFonction,
  _aucunEnum,
  _aucunTypeCompose,
]
