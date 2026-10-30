-- @spec CRM-071 (docs/BACKLOG.md) — tranche T1 : les vues sauvegardées en base
-- @spec docs/SPEC-vues-import-export.md §2.1 (la table, l'unicité du nom), §2.2 (les filtres aux clés fermées), §2.3 (qui
--       lit, qui écrit : la propriétaire pour une vue privée, l'administrateur pour une vue de l'espace) ;
--       docs/SCHEMA.md « Migration `0135` » ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 774 à 776
--
-- UNE TABLE, ET TOUTES LES RÈGLES EN BASE (`CLAUDE.md` §10) : l'espace d'une vue, sa propriétaire, la forme de ses
-- filtres et le droit de publier pour l'espace sont tenus ici ; l'écran et le connecteur n'ont rien à garder.

-- =============================================================================================
-- 1. Les filtres d'une vue — §2.2
-- =============================================================================================

-- Les clés stockées sont en anglais (docs/DAT.md §12 bis) ; l'écran les traduit vers les paramètres de l'adresse.
create or replace function app.saved_view_filters_valid(p_filters jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
	select pg_catalog.jsonb_typeof(p_filters) = 'object'
	   and not exists (
	       select 1 from pg_catalog.jsonb_object_keys(p_filters) k
	        where k not in ('sort', 'direction', 'step_id', 'label_id', 'search', 'snoozed'))
	   and (not p_filters ? 'sort'
	        or p_filters ->> 'sort' in ('title', 'amount', 'next_action_at', 'created_at'))
	   and (not p_filters ? 'direction' or p_filters ->> 'direction' in ('asc', 'desc'))
	   and (not p_filters ? 'step_id'
	        or (p_filters ->> 'step_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
	   and (not p_filters ? 'label_id'
	        or (p_filters ->> 'label_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
	   and (not p_filters ? 'search'
	        or (pg_catalog.jsonb_typeof(p_filters -> 'search') = 'string'
	            and pg_catalog.char_length(p_filters ->> 'search') <= 200))
	   and (not p_filters ? 'snoozed' or p_filters ->> 'snoozed' in ('hidden', 'shown'));
$$;

-- =============================================================================================
-- 2. La table — §2.1
-- =============================================================================================

create table if not exists public.saved_views (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null,
	channel_id   uuid        not null,
	visibility   text        not null default 'private',
	owner_id     uuid        not null default auth.uid() references public.profiles (id) on delete cascade,
	name         text        not null,
	filters      jsonb       not null default '{}'::jsonb,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	constraint saved_views_channel_fkey
		foreign key (channel_id, workspace_id) references public.channels (id, workspace_id) on delete cascade,
	constraint saved_views_visibility_check check (visibility in ('private', 'workspace')),
	constraint saved_views_name_check check (app.btrim_blancs(name) <> '' and char_length(app.btrim_blancs(name)) <= 60),
	constraint saved_views_filters_check check (app.saved_view_filters_valid(filters))
);

-- Un nom par channel et par propriétaire parmi les vues privées ; un nom par channel parmi les vues de l'espace. Sans
-- tenir compte de la casse ni des blancs superflus.
create unique index if not exists saved_views_private_name_key
	on public.saved_views (channel_id, owner_id, lower(app.btrim_blancs(name))) where visibility = 'private';
create unique index if not exists saved_views_workspace_name_key
	on public.saved_views (channel_id, lower(app.btrim_blancs(name))) where visibility = 'workspace';
create index if not exists saved_views_owner_idx on public.saved_views (owner_id);

comment on table public.saved_views is
	'CRM-071 — docs/SPEC-vues-import-export.md §2. Les vues sauvegardées de la vue liste d''un channel : privées, ou '
	'publiées pour l''espace par un administrateur.';

-- Avant l'écriture : l'espace est celui du CHANNEL (le client ne l'envoie pas), la propriétaire est l'appelant, et ni
-- l'un ni l'autre ne change ensuite ; une vue de l'espace ne redevient pas privée (§2.3 : on la supprime).
create or replace function app.saved_views_avant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		new.workspace_id := (select c.workspace_id from public.channels c where c.id = new.channel_id);
		-- La clé de service (seed, preuves) n'a pas d'appelant : elle garde la propriétaire qu'elle envoie.
		new.owner_id := coalesce((select auth.uid()), new.owner_id);
		new.created_at := now();
	else
		new.workspace_id := old.workspace_id;
		new.channel_id := old.channel_id;
		new.owner_id := old.owner_id;
		new.created_at := old.created_at;
		if old.visibility = 'workspace' and new.visibility = 'private' then
			raise exception 'saved_view_cannot_be_unpublished' using errcode = '22023';
		end if;
	end if;
	new.updated_at := now();
	return new;
end;
$$;

drop trigger if exists saved_views_avant on public.saved_views;
create trigger saved_views_avant
	before insert or update on public.saved_views
	for each row execute function app.saved_views_avant();

alter function app.saved_views_avant() owner to postgres;
revoke all on function app.saved_views_avant() from public, anon, authenticated;
alter function app.saved_view_filters_valid(jsonb) owner to postgres;
grant execute on function app.saved_view_filters_valid(jsonb) to authenticated, service_role;

-- =============================================================================================
-- 3. Droits — RLS et privilèges (`CLAUDE.md` §10) — §2.3
-- =============================================================================================

alter table public.saved_views enable row level security;

-- Lire : sa vue privée, si l'on lit encore le channel ; une vue de l'espace, si l'on lit le channel.
drop policy if exists saved_views_lecture on public.saved_views;
create policy saved_views_lecture on public.saved_views
	for select to authenticated
	using (app.can_read_channel(channel_id)
	       and (visibility = 'workspace' or owner_id = (select auth.uid())));

-- Créer : une vue privée pour soi sur un channel qu'on lit ; une vue de l'espace si l'on administre l'espace du channel.
drop policy if exists saved_views_creation on public.saved_views;
create policy saved_views_creation on public.saved_views
	for insert to authenticated
	with check (app.can_read_channel(channel_id)
	            and owner_id = (select auth.uid())
	            and (visibility = 'private'
	                 or app.is_workspace_admin((select c.workspace_id from public.channels c where c.id = channel_id))));

-- Modifier : sa vue privée ; une vue de l'espace, par un administrateur. La publication (privée → espace) n'est permise
-- qu'à un administrateur, sur sa propre vue : le `with check` le tient.
drop policy if exists saved_views_modification on public.saved_views;
create policy saved_views_modification on public.saved_views
	for update to authenticated
	using (app.can_read_channel(channel_id)
	       and ((visibility = 'private' and owner_id = (select auth.uid()))
	            or (visibility = 'workspace' and app.is_workspace_admin(workspace_id))))
	with check ((visibility = 'private' and owner_id = (select auth.uid()))
	            or (visibility = 'workspace' and app.is_workspace_admin(workspace_id)));

-- Supprimer : sa vue privée ; une vue de l'espace, par un administrateur.
drop policy if exists saved_views_suppression on public.saved_views;
create policy saved_views_suppression on public.saved_views
	for delete to authenticated
	using ((visibility = 'private' and owner_id = (select auth.uid()))
	       or (visibility = 'workspace' and app.is_workspace_admin(workspace_id)));

revoke all on public.saved_views from anon, authenticated;
grant select, delete on public.saved_views to authenticated;
grant insert (channel_id, visibility, name, filters) on public.saved_views to authenticated;
grant update (name, filters, visibility) on public.saved_views to authenticated;
grant all on public.saved_views to service_role;

notify pgrst, 'reload schema';
