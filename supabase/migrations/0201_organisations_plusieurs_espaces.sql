-- @spec CRM-161 (docs/BACKLOG.md) — tranche T3.c : la liste des organisations lit plusieurs espaces et dit l'espace de
--       chaque ligne, pour le filtre « Espace » de l'onglet, qui se fait par la lecture (la liste est paginée)
-- @spec docs/SPEC-espace-courant.md §16.8.1, §16.2 ; docs/SPEC-organisations.md §8.2, §9.1 ; docs/SCHEMA.md « Migration
--       `0201` » ; docs/SPEC-permissions-rls.md §7 (un espace non lu ne rend rien) ; décisions 963 et 965
--
-- LE TYPE DE RETOUR CHANGE (`workspace_id` avant `total_count`) : la fonction est supprimée puis recréée, ses droits avec
-- elle, dans la transaction de la migration. Aucune vue ni fonction SQL n'en dépend ; la webapp et le connecteur
-- l'appellent par le nom de leurs paramètres.
--
-- `p_workspace_id` EST GARDÉ, FACULTATIF : la webapp livrée avant cette migration et le connecteur (`crm_organization_list`)
-- l'appellent encore, et leurs lignes ne changent pas. `p_workspace_ids` vient en dernier, comme `p_category_ids` l'a fait
-- (`0188`) : un appel positionnel d'avant garde son sens.
--
-- Retour arrière : supprimer cette signature, puis rejouer la section 7 de la `0188` (définition, commentaire, droits).

drop function if exists public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[]);

create function public.organization_list(
	p_workspace_id uuid default null,
	p_search text default null,
	p_track_ids uuid[] default null,
	p_revenues text default 'all',
	p_sort text default 'name',
	p_descending boolean default false,
	p_limit integer default 50,
	p_offset integer default 0,
	p_category_ids uuid[] default null,
	p_workspace_ids uuid[] default null
)
returns table (
	id uuid,
	name text,
	domain text,
	website text,
	contacts integer,
	has_revenues boolean,
	workspace_id uuid,
	total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
	v_recherche  text := nullif(btrim(coalesce(p_search, '')), '');
	v_motif      text;
	v_tracks     uuid[] := case when cardinality(coalesce(p_track_ids, '{}')) = 0 then null else p_track_ids end;
	v_categories uuid[] := case when cardinality(coalesce(p_category_ids, '{}')) = 0 then null else p_category_ids end;
	-- LA PORTÉE, DANS CET ORDRE (§16.8.1) : les espaces donnés ; sinon l'espace donné ; sinon tous ceux que la RLS laisse
	-- lire (null : aucun filtre ici, la RLS d'`organizations` reste la règle).
	v_espaces    uuid[] := case
	                         when cardinality(coalesce(p_workspace_ids, '{}')) > 0 then p_workspace_ids
	                         when p_workspace_id is not null then array[p_workspace_id]
	                       end;
	v_limite     integer := least(greatest(coalesce(p_limit, 50), 1), 100);
	v_decalage   integer := greatest(coalesce(p_offset, 0), 0);
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
		select o.id, o.name, o.domain, o.website, o.workspace_id,
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
		 where (v_espaces is null or o.workspace_id = any (v_espaces))
		   and (v_motif is null
		        or o.name ilike v_motif
		        or coalesce(o.domain, '') ilike v_motif
		        or coalesce(o.website, '') ilike v_motif)
		   and (v_tracks is null or exists (
		           select 1 from public.organization_tracks(array[o.id]) ot where ot.track_id = any (v_tracks)))
		   -- L'UNE DES CATÉGORIES DONNÉES, ARCHIVÉES COMPRISES (§9.1) : on retrouve les organisations d'une catégorie qu'on
		   -- vient d'archiver.
		   and (v_categories is null or exists (
		           select 1 from public.organization_category_links l
		            where l.organization_id = o.id and l.category_id = any (v_categories)))
	),
	filtrees as (
		select * from candidates c
		 where coalesce(p_revenues, 'all') = 'all'
		    or (p_revenues = 'with' and c.has_revenues)
		    or (p_revenues = 'without' and not c.has_revenues)
	)
	select f.id, f.name, f.domain, f.website, f.contacts, f.has_revenues, f.workspace_id, count(*) over ()
	  from filtrees f
	 order by
	   case when p_sort = 'contacts' and not coalesce(p_descending, false) then f.contacts end asc nulls last,
	   case when p_sort = 'contacts' and coalesce(p_descending, false) then f.contacts end desc nulls last,
	   case when coalesce(p_sort, 'name') = 'name' and coalesce(p_descending, false) then lower(f.name) end desc,
	   lower(f.name) asc,
	   f.id asc
	 limit v_limite offset v_decalage;
end;
$$;

comment on function public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[], uuid[]) is
	'CRM-152 — docs/SPEC-organisations.md §8.2 ; CRM-153 — §9.1 ; CRM-161 T3.c — docs/SPEC-espace-courant.md §16.8.1. '
	'Les organisations des espaces donnés (p_workspace_ids, sinon p_workspace_id, sinon tous ceux que l''appelant lit), '
	'chaque ligne portant son workspace_id : recherche dans le nom, le domaine et le site web ; l''un des tracks donnés ; '
	'l''une des catégories données, archivées comprises ; avec ou sans recettes ; tri par nom ou contacts, ordre total ; '
	'paginé, total_count compté sur toute la portée. Un espace non lu ne rend rien. 22023 invalid_revenues_filter, '
	'invalid_sort.';

revoke all on function public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[], uuid[])
	from public, anon;
grant execute on function public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[], uuid[])
	to authenticated;
