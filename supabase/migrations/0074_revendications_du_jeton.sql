-- @spec CRM-092 (docs/BACKLOG.md) — la RLS lit les revendications du jeton sans GoTrue
-- @spec docs/SPEC-session-sso.md §7.1 (migration élevée), §3 (K11, K12)
-- @spec docs/JOURNAL.md décisions 580 (K11, K12) et 581 (élévation retenue), 363 (motif exigé)
-- @migration-role: supabase_admin
--
-- POURQUOI CE FICHIER S'EXÉCUTE SOUS UN AUTRE RÔLE — MOTIF MESURÉ (décision 363).
--
-- MESURÉ le 2026-09-23 (K11) : sur une base `supabase/postgres:17.6.1.136` où GoTrue n'a jamais
-- démarré, `auth.uid()` vaut `select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid`.
-- PostgREST 14 ne pose que `request.jwt.claims` (`PGRST_DB_USE_LEGACY_GUCS=false`) : sans GoTrue,
-- `auth.uid()` rend donc `NULL` et TOUTE la RLS du produit refuse tout. C'est GoTrue qui réécrivait
-- ces fonctions à son démarrage ; `CRM-092` le retire.
--
-- MESURÉ (K12) : ces fonctions appartiennent à `supabase_auth_admin` — ou à `supabase_admin` avant la
-- migration interne de l'image qui change leur propriétaire —, et `postgres` n'est membre d'aucun
-- des deux. Seul un superutilisateur peut les remplacer.
--
-- ET C'EST PRÉCISÉMENT POURQUOI RIEN D'AUTRE N'EST CRÉÉ ICI. Les quatre fonctions sont des fonctions
-- SQL ordinaires, sans `SECURITY DEFINER` : les créer sous un superutilisateur ne leur donne aucun
-- droit. Elles reprennent la forme EXACTE que GoTrue installait, et retrouvent son propriétaire. Sur
-- une base où GoTrue a tourné, cette migration réécrit une définition identique.

do $$
begin
	if current_user <> 'supabase_admin' then
		raise exception 'migration_role_inattendu: % (supabase_admin requis)', current_user;
	end if;
end;
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

-- `auth.jwt()` n'existe pas sur une base neuve : l'image ne pose que les trois premières (K10).
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.email() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;

comment on function auth.uid() is
	'CRM-092 — docs/SPEC-session-sso.md §7.1. sub du jeton ; forme de GoTrue, sans GoTrue.';
comment on function auth.role() is
	'CRM-092 — docs/SPEC-session-sso.md §7.1. role du jeton ; forme de GoTrue, sans GoTrue.';
comment on function auth.email() is
	'CRM-092 — docs/SPEC-session-sso.md §7.1. email du jeton ; le jeton interne n''en porte pas.';
comment on function auth.jwt() is
	'CRM-092 — docs/SPEC-session-sso.md §7.1. Revendications du jeton ; forme de GoTrue.';
