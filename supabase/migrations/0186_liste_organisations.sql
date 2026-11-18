-- @spec CRM-152 (docs/BACKLOG.md) — tranche T1 : les tracks d'une organisation par ses contacts, et la liste des organisations
--       en base — recherche, filtre par track, avec ou sans recettes, tri, pagination
-- @spec docs/SPEC-organisations.md §8.1, §8.2 ; docs/SCHEMA.md « Migration `0186` »
--       docs/JOURNAL.md décisions 931 et 936
--
-- DEUX FONCTIONS `SECURITY INVOKER` : tout ce qu'elles rendent passe par la RLS de chaque table traversée — une affaire, un
-- rattachement, un channel ou un track illisible n'y entre pas, et rien ne trahit son existence. Aucune table, aucune
-- politique nouvelle.

-- =============================================================================================
-- 1. Les tracks d'une organisation (§8.1)
-- =============================================================================================
--
-- Un contact de l'organisation lié à une affaire hors corbeille, placée par un rattachement non archivé dans un channel
-- puis un track ni archivés ni à la corbeille (décision 931). L'ordre est celui de la barre latérale.
create or replace function public.organization_tracks(p_organization_ids uuid[])
returns table (organization_id uuid, track_id uuid, name text, slug text, color text, icon text)
language sql
stable
security invoker
set search_path = ''
as $$
	select distinct on (ct.organization_id, t.position, t.id)
	       ct.organization_id, t.id, t.name, t.slug, t.color, t.icon
	  from public.contacts ct
	  join public.card_contacts cc on cc.contact_id = ct.id
	  join public.cards c on c.id = cc.card_id and c.deleted_at is null
	  join public.card_placements p on p.card_id = c.id and p.archived_at is null
	  join public.channels ch on ch.id = p.channel_id and ch.archived_at is null and ch.deleted_at is null
	  join public.tracks t on t.id = ch.track_id and t.archived_at is null and t.deleted_at is null
	 where ct.organization_id = any (coalesce(p_organization_ids, '{}'))
	 order by ct.organization_id, t.position, t.id;
$$;

comment on function public.organization_tracks(uuid[]) is
	'CRM-152 — docs/SPEC-organisations.md §8.1. Les tracks de chaque organisation, par ses contacts liés à une affaire hors '
	'corbeille, placée dans un channel puis un track ni archivés ni à la corbeille ; sous la RLS de l''appelant.';

-- =============================================================================================
-- 2. La liste des organisations, en base et paginée (§8.2)
-- =============================================================================================
create or replace function public.organization_list(
	p_workspace_id uuid,
	p_search text default null,
	p_track_ids uuid[] default null,
	p_revenues text default 'all',
	p_sort text default 'name',
	p_descending boolean default false,
	p_limit integer default 50,
	p_offset integer default 0
)
returns table (
	id uuid,
	name text,
	domain text,
	website text,
	contacts integer,
	has_revenues boolean,
	total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
	v_recherche text := nullif(btrim(coalesce(p_search, '')), '');
	v_motif     text;
	v_tracks    uuid[] := case when cardinality(coalesce(p_track_ids, '{}')) = 0 then null else p_track_ids end;
	v_limite    integer := least(greatest(coalesce(p_limit, 50), 1), 100);
	v_decalage  integer := greatest(coalesce(p_offset, 0), 0);
begin
	if coalesce(p_revenues, 'all') not in ('all', 'with', 'without') then
		raise exception 'invalid_revenues_filter' using errcode = '22023';
	end if;
	if coalesce(p_sort, 'name') not in ('name', 'contacts') then
		raise exception 'invalid_sort' using errcode = '22023';
	end if;
	-- LES JOKERS DE LA SAISIE SONT ÉCHAPPÉS : « 100% » cherche « 100% », pas « 100 » suivi de n'importe quoi.
	if v_recherche is not null then
		v_motif := '%' || replace(replace(replace(v_recherche, '\', '\\'), '%', '\%'), '_', '\_') || '%';
	end if;

	return query
	with candidates as (
		select o.id, o.name, o.domain, o.website,
		       (select count(*) from public.contacts ct where ct.organization_id = o.id)::integer as contacts,
		       exists (
		           select 1
		             from public.contacts ct
		             join public.card_contacts cc on cc.contact_id = ct.id
		             join public.cards c on c.id = cc.card_id and c.deleted_at is null
		             join public.card_revenues r on r.card_id = c.id
		            where ct.organization_id = o.id
		       ) as has_revenues
		  from public.organizations o
		 where o.workspace_id = p_workspace_id
		   and (v_motif is null
		        or o.name ilike v_motif
		        or coalesce(o.domain, '') ilike v_motif
		        or coalesce(o.website, '') ilike v_motif)
		   and (v_tracks is null or exists (
		           select 1 from public.organization_tracks(array[o.id]) ot where ot.track_id = any (v_tracks)))
	),
	filtrees as (
		select * from candidates c
		 where coalesce(p_revenues, 'all') = 'all'
		    or (p_revenues = 'with' and c.has_revenues)
		    or (p_revenues = 'without' and not c.has_revenues)
	)
	select f.id, f.name, f.domain, f.website, f.contacts, f.has_revenues, count(*) over ()
	  from filtrees f
	 -- UN ORDRE TOTAL : la clé choisie, puis le nom, puis l'identifiant — sans quoi une page pourrait répéter ou sauter une
	 -- organisation à égalité.
	 order by
	   case when p_sort = 'contacts' and not coalesce(p_descending, false) then f.contacts end asc nulls last,
	   case when p_sort = 'contacts' and coalesce(p_descending, false) then f.contacts end desc nulls last,
	   case when coalesce(p_sort, 'name') = 'name' and coalesce(p_descending, false) then lower(f.name) end desc,
	   lower(f.name) asc,
	   f.id asc
	 limit v_limite offset v_decalage;
end;
$$;

comment on function public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer) is
	'CRM-152 — docs/SPEC-organisations.md §8.2. Les organisations de l''espace que l''appelant lit : recherche dans le nom, '
	'le domaine et le site web ; l''un des tracks donnés ; avec ou sans recettes ; tri par nom ou contacts, ordre total ; '
	'paginé, total_count compté. 22023 invalid_revenues_filter, invalid_sort.';

revoke all on function public.organization_tracks(uuid[]) from public, anon;
revoke all on function public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer) from public, anon;
grant execute on function public.organization_tracks(uuid[]) to authenticated;
grant execute on function public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer) to authenticated;

notify pgrst, 'reload schema';
