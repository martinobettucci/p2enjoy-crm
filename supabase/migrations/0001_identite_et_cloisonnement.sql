-- @spec CRM-003 (docs/BACKLOG.md) — migrations d'amorçage : identité et cloisonnement
-- @spec docs/SCHEMA.md « Conventions générales », §1 (identité et cloisonnement), §9 (fonctions)
-- @spec docs/SPEC-permissions-rls.md §2 (rôles), §3 (fonctions), §4 (politiques), §7 (preuves)
-- @spec docs/DAT.md §3.2 (base de données), §7 (autorisations)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- Première migration applicative du produit. Elle livre :
--
--   * les extensions dont le schéma dépend ;
--   * le schéma `app`, réservé aux fonctions d'autorisation et utilitaires, **non exposé** par
--     PostgREST (`PGRST_DB_SCHEMAS=public,storage,graphql_public`) ;
--   * `public.profiles`, prolongement de `auth.users`, alimenté par trigger à la création d'un
--     compte ;
--   * `public.workspaces` et `public.workspace_members`, cloisonnement de premier niveau ;
--   * `public.track_members` et `public.channel_members`, droits fins facultatifs.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution, pas un confort d'écriture.
-- ---------------------------------------------------------------------------------------------
-- Le conteneur `migrations-runner` livré par `CRM-001` ne tient **aucun registre** des migrations
-- déjà appliquées : il rejoue l'intégralité de `supabase/migrations/*.sql` à chaque démarrage de
-- la pile. Une migration qui échouerait au second passage empêcherait PostgREST de démarrer,
-- puisqu'il attend la terminaison réussie de ce conteneur. Toute migration du dépôt doit donc
-- être rejouable sans erreur ni effet de bord (`docs/JOURNAL.md`, décision 20).
--
-- ---------------------------------------------------------------------------------------------
-- Sécurité : refus par défaut, politiques livrées plus tard.
-- ---------------------------------------------------------------------------------------------
-- RLS est activée sur les cinq tables **sans aucune politique**. L'accès est donc refusé par
-- défaut à `anon` comme à `authenticated` : une lecture retourne zéro ligne, une écriture est
-- refusée. Les fonctions d'autorisation et les politiques sont l'objet de `CRM-010` et
-- `CRM-012`. Livrer ces tables sans RLS, même le temps d'une unité, exposerait leur contenu à
-- quiconque détient la clé anonyme, qui est publique par construction.
--
-- Les privilèges de table sont accordés **explicitement**, sans s'en remettre aux privilèges par
-- défaut de l'image PostgreSQL : `SELECT` pour `anon` et `authenticated` afin qu'un refus de
-- lecture se manifeste par zéro ligne et non par une erreur ambiguë
-- (`docs/SPEC-permissions-rls.md` §7, dernier paragraphe).

-- =============================================================================================
-- 1. Extensions
-- =============================================================================================
-- `gen_random_uuid()` est la fabrique de clés primaires retenue par `docs/SCHEMA.md`
-- (« Conventions générales »). L'extension est déclarée explicitement plutôt que supposée
-- présente dans l'image.

create extension if not exists pgcrypto with schema extensions;

-- =============================================================================================
-- 2. Schéma applicatif `app`
-- =============================================================================================
-- Accueille les fonctions d'autorisation `SECURITY DEFINER` (`CRM-010`) et les utilitaires de
-- schéma. Il n'est pas listé dans `PGRST_DB_SCHEMAS` : rien de ce qu'il contient n'est joignable
-- directement par l'API REST, seulement par les politiques et les triggers.

create schema if not exists app authorization postgres;

comment on schema app is
	'CRM-003 — fonctions d''autorisation et utilitaires de schéma. Non exposé par PostgREST.';

-- `USAGE` est accordé aux trois rôles applicatifs, `anon` compris : une politique RLS qui
-- appellera `app.can_read_card()` (CRM-010) est évaluée avec les droits du rôle courant. Sans
-- `USAGE`, un appelant anonyme recevrait une erreur de privilège au lieu du refus attendu, qui
-- est « zéro ligne ».
grant usage on schema app to anon, authenticated, service_role;

-- Aucune fonction du schéma n'est exécutable par défaut : `CRM-010` accordera explicitement
-- `EXECUTE` à qui doit appeler chaque fonction (`docs/SPEC-permissions-rls.md` §3).
alter default privileges in schema app revoke execute on functions from public;

-- =============================================================================================
-- 3. Utilitaire de schéma : maintien de `updated_at`
-- =============================================================================================
-- `SECURITY INVOKER` : la fonction ne fait qu'écrire dans la ligne en cours de modification,
-- elle n'a besoin d'aucun privilège supplémentaire. `search_path` est vidé, comme sur toute
-- fonction du schéma `app`, pour qu'aucun objet ne puisse être résolu par un chemin détourné.

create or replace function app.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

comment on function app.set_updated_at() is
	'CRM-003 — trigger BEFORE UPDATE : maintient `updated_at` à l''heure du serveur.';

-- =============================================================================================
-- 4. `public.profiles` — prolongement de `auth.users`
-- =============================================================================================
-- docs/SCHEMA.md §1. La table ne duplique ni l'email ni le mot de passe : `auth.users` reste
-- l'autorité de l'identité, `profiles` ne porte que ce qui est affiché dans le produit.

create table if not exists public.profiles (
	id         uuid        primary key references auth.users (id) on delete cascade,
	full_name  text        not null,
	avatar_url text,
	locale     text        not null default 'fr',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

comment on table  public.profiles is
	'CRM-003 — docs/SCHEMA.md §1. Prolonge auth.users ; créée par trigger à l''inscription.';
comment on column public.profiles.id is
	'Identifiant du compte GoTrue. La suppression du compte supprime le profil.';
comment on column public.profiles.full_name is
	'Nom affiché. Non nul : voir app.handle_new_user() pour la chaîne de repli.';
comment on column public.profiles.locale is
	'Langue de l''interface. Défaut « fr » (docs/DAT.md, langue par défaut du produit).';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
	before update on public.profiles
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 5. Création automatique du profil
-- =============================================================================================
-- `docs/SCHEMA.md` §1 : « Créée par trigger à l'inscription. » Le trigger vit sur `auth.users`,
-- écrit par GoTrue : c'est le seul point qui capte **tous** les modes de création de compte —
-- invitation d'un administrateur (`CRM-011`), amorçage du seed (`CRM-005`), création par l'API
-- d'administration.
--
-- `SECURITY DEFINER` : la ligne est insérée par GoTrue sous le rôle `supabase_auth_admin`, qui
-- n'a aucun droit sur `public.profiles`. La fonction appartient à `postgres`, propriétaire de la
-- table.
--
-- `full_name` est non nul. La chaîne de repli est déterministe et documentée, dans cet ordre :
-- métadonnée `full_name`, puis `name`, puis la partie locale de l'email, puis un libellé dérivé
-- de l'identifiant. Le dernier repli existe pour les comptes sans email (téléphone, SSO sans
-- adresse) : sans lui, le trigger ferait échouer la création du compte lui-même.
--
-- `on conflict (id) do nothing` : un profil déjà présent pour cet identifiant n'est pas écrasé.
-- Ce n'est pas un masquage d'erreur — c'est la seule sémantique correcte, `auth.users.id` étant
-- la clé du profil : la ligne visée existe déjà et porte des valeurs éventuellement éditées par
-- l'utilisateur, qu'une réécriture perdrait.

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.profiles (id, full_name, avatar_url, locale)
	values (
		new.id,
		coalesce(
			nullif(new.raw_user_meta_data ->> 'full_name', ''),
			nullif(new.raw_user_meta_data ->> 'name', ''),
			nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
			'Utilisateur ' || left(new.id::text, 8)
		),
		nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
		coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'fr')
	)
	on conflict (id) do nothing;

	return new;
end;
$$;

alter function app.handle_new_user() owner to postgres;

comment on function app.handle_new_user() is
	'CRM-003 — trigger AFTER INSERT sur auth.users : crée le profil correspondant.';

-- Personne n'appelle cette fonction directement : elle n'est exécutée que par le trigger, avec
-- les droits de son propriétaire.
revoke all on function app.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
	after insert on auth.users
	for each row execute function app.handle_new_user();

-- =============================================================================================
-- 6. `public.workspaces` — cloisonnement de premier niveau
-- =============================================================================================

create table if not exists public.workspaces (
	id             uuid        primary key default gen_random_uuid(),
	name           text        not null,
	slug           text        not null unique,
	inbound_domain text,
	settings       jsonb       not null default '{}'::jsonb,
	created_at     timestamptz not null default now(),
	updated_at     timestamptz not null default now()
);

comment on table  public.workspaces is
	'CRM-003 — docs/SCHEMA.md §1. Cloisonnement de premier niveau du produit.';
comment on column public.workspaces.inbound_domain is
	'Domaine des adresses de card, ex. « crm.p2enjoy.studio » (docs/SCHEMA.md §5).';
comment on column public.workspaces.settings is
	'Réglages du workspace. Objet JSON, jamais nul : « {} » signifie « aucun réglage ».';

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
	before update on public.workspaces
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 7. `public.workspace_members` — rôle d'un utilisateur dans un workspace
-- =============================================================================================
-- `docs/SPEC-permissions-rls.md` §2.1. L'absence de ligne signifie que l'utilisateur n'est pas
-- membre : il n'existe pas de rôle implicite.

create table if not exists public.workspace_members (
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	user_id      uuid        not null references public.profiles (id)   on delete cascade,
	role         text        not null check (role in ('admin', 'business_developer', 'viewer')),
	created_at   timestamptz not null default now(),
	primary key (workspace_id, user_id)
);

comment on table public.workspace_members is
	'CRM-003 — docs/SCHEMA.md §1, docs/SPEC-permissions-rls.md §2.1. Rôle de workspace.';

-- La clé primaire indexe `(workspace_id, user_id)` ; l'index inverse sert la question posée à
-- chaque requête d'autorisation : « à quels workspaces cet utilisateur appartient-il ? ».
create index if not exists workspace_members_user_id_idx
	on public.workspace_members (user_id);

-- =============================================================================================
-- 8. Droits fins : `public.track_members`, `public.channel_members`
-- =============================================================================================
-- `docs/SPEC-permissions-rls.md` §2.2. **Absence de ligne = accès hérité du rôle de workspace.**
-- Une ligne surcharge explicitement, et la règle la plus spécifique gagne : channel, puis track,
-- puis workspace. La résolution elle-même est l'objet de `CRM-012`.
--
-- `track_id` et `channel_id` ne portent **aucune clé étrangère** : les tables `tracks` et
-- `channels` sont livrées par `CRM-020` et `CRM-021`, après cette migration. `docs/SCHEMA.md` §1
-- ne déclare d'ailleurs pas ces clés, à la différence de `workspace_members`. La contrainte
-- manquante est consignée dans `docs/INCONSISTENCY_REPORT.md`, INC-010, et **non résolue
-- implicitement** : aucune table `tracks` n'est créée ici pour la faire disparaître, ce qui
-- déborderait du périmètre de l'unité.

create table if not exists public.track_members (
	track_id   uuid        not null,
	user_id    uuid        not null references public.profiles (id) on delete cascade,
	access     text        not null check (access in ('member', 'viewer', 'none')),
	created_at timestamptz not null default now(),
	primary key (track_id, user_id)
);

comment on table public.track_members is
	'CRM-003 — docs/SCHEMA.md §1. Droit fin sur un track. Aucune ligne = accès hérité du rôle '
	'de workspace. Clé étrangère vers `tracks` différée à CRM-020 (INC-010).';

create index if not exists track_members_user_id_idx
	on public.track_members (user_id);

create table if not exists public.channel_members (
	channel_id uuid        not null,
	user_id    uuid        not null references public.profiles (id) on delete cascade,
	access     text        not null check (access in ('member', 'viewer', 'none')),
	created_at timestamptz not null default now(),
	primary key (channel_id, user_id)
);

comment on table public.channel_members is
	'CRM-003 — docs/SCHEMA.md §1. Droit fin sur un channel. Aucune ligne = accès hérité. Clé '
	'étrangère vers `channels` différée à CRM-021 (INC-010).';

create index if not exists channel_members_user_id_idx
	on public.channel_members (user_id);

-- =============================================================================================
-- 9. Refus par défaut : RLS activée, aucune politique
-- =============================================================================================
-- `FORCE ROW LEVEL SECURITY` n'est **pas** utilisée : elle soumettrait aussi le propriétaire des
-- tables aux politiques, donc `app.handle_new_user()`, qui s'exécute avec les droits de
-- `postgres`. Le trigger ne pourrait alors plus créer le moindre profil. Les rôles qui
-- contournent RLS sont ceux qui le doivent : `postgres` et `service_role`.

alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.track_members     enable row level security;
alter table public.channel_members   enable row level security;

-- =============================================================================================
-- 10. Privilèges explicites
-- =============================================================================================
-- Les privilèges par défaut de l'image accordent déjà tout à `anon`, `authenticated` et
-- `service_role` sur les tables créées dans `public`. On ne s'y fie pas : les droits sont posés
-- explicitement, de sorte que le comportement du produit ne dépende pas d'un réglage d'image
-- susceptible de changer d'une version à l'autre.

-- `profiles` : lisible (filtré par RLS dès `CRM-010`), modifiable par son titulaire. La création
-- et la suppression appartiennent au trigger et à la cascade depuis `auth.users` : aucun client
-- ne les exécute.
revoke all on public.profiles from anon, authenticated;
grant select          on public.profiles to anon, authenticated;
grant update          on public.profiles to authenticated;
grant all privileges  on public.profiles to service_role;

revoke all on public.workspaces from anon, authenticated;
grant select                          on public.workspaces to anon, authenticated;
grant insert, update, delete          on public.workspaces to authenticated;
grant all privileges                  on public.workspaces to service_role;

revoke all on public.workspace_members from anon, authenticated;
grant select                          on public.workspace_members to anon, authenticated;
grant insert, update, delete          on public.workspace_members to authenticated;
grant all privileges                  on public.workspace_members to service_role;

revoke all on public.track_members from anon, authenticated;
grant select                          on public.track_members to anon, authenticated;
grant insert, update, delete          on public.track_members to authenticated;
grant all privileges                  on public.track_members to service_role;

revoke all on public.channel_members from anon, authenticated;
grant select                          on public.channel_members to anon, authenticated;
grant insert, update, delete          on public.channel_members to authenticated;
grant all privileges                  on public.channel_members to service_role;

-- PostgREST met son schéma en cache : sans ce signal, les tables nouvellement créées ne sont pas
-- visibles de l'API tant que le service n'a pas redémarré.
notify pgrst, 'reload schema';
