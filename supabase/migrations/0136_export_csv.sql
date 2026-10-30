-- @spec CRM-071 (docs/BACKLOG.md) — tranche T4 : l'export CSV de la vue liste d'un channel et du carnet
-- @spec docs/SPEC-vues-import-export.md §5.1 (ce qui s'exporte), §5.2 (sous la RLS de la personne, journalisé, plafond de
--       5 000 lignes, refus nommés) ; docs/SPEC-audit.md §3, §4.5 (la famille `export`) ; docs/SCHEMA.md « Migration
--       `0136` » ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 774 à 777
--
-- LES LECTURES SONT CELLES DE LA PERSONNE (`SECURITY INVOKER`) : la RLS de `card_placements`, `cards`, `contacts` et des
-- tables plongées décide seule de ce qui sort. Le journal passe par `app.audit_export`, définisseur que seuls ces deux
-- exports atteignent — PostgREST n'expose pas le schéma `app`.

-- =============================================================================================
-- 1. Le journal : deux types d'objet de plus, et l'écriture d'un export
-- =============================================================================================

alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
alter table public.audit_log add constraint audit_log_entity_type_check
	check (entity_type in ('member', 'invitation', 'track_access', 'channel_access', 'workspace', 'track', 'channel',
	                       'workflow', 'workflow_step', 'workflow_transition', 'workflow_node', 'form_field',
	                       'form_field_rule', 'mail_account', 'mail_identity', 'card', 'comment', 'activity', 'contact',
	                       'organization', 'session', 'audit_log', 'card_list', 'contact_list'));

create or replace function app.audit_export(p_workspace uuid, p_entity_type text, p_count integer, p_details jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	if p_entity_type not in ('card_list', 'contact_list') then
		raise exception 'export_entity_unknown' using errcode = '22023';
	end if;
	-- Un appelant ne journalise que dans un espace dont il est membre : le journal reste celui de ses propres gestes.
	if not app.is_workspace_member(p_workspace) then
		raise exception 'workspace_not_found' using errcode = 'P0002';
	end if;
	perform app.audit_record(p_workspace, 'exported', p_entity_type, null, null,
	                         coalesce(p_details, '{}'::jsonb) || pg_catalog.jsonb_build_object('count', p_count));
end;
$$;

alter function app.audit_export(uuid, text, integer, jsonb) owner to postgres;
revoke all on function app.audit_export(uuid, text, integer, jsonb) from public, anon;
grant execute on function app.audit_export(uuid, text, integer, jsonb) to authenticated, service_role;

-- =============================================================================================
-- 2. L'export de la vue liste d'un channel — §5.1, §5.2
-- =============================================================================================

create or replace function public.export_cards(p_channel uuid, p_filters jsonb default '{}'::jsonb)
returns table (
	card_id uuid, title text, labels text, owner_name text, step_label text, amount numeric, currency text,
	next_action text, next_action_at timestamptz, track_slug text, channel_slug text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	v_espace   uuid;
	v_filtres  jsonb := coalesce(p_filters, '{}'::jsonb);
	v_tri      text;
	v_sens     text;
	v_lignes   jsonb;
	v_nombre   integer;
begin
	if not app.saved_view_filters_valid(v_filtres) then
		raise exception 'invalid_filters' using errcode = '22023';
	end if;
	-- Le channel, lu sous la RLS de la personne : illisible et inexistant se confondent.
	select c.workspace_id into v_espace from public.channels c where c.id = p_channel and c.deleted_at is null;
	if v_espace is null then
		raise exception 'channel_not_found' using errcode = 'P0002';
	end if;
	v_tri := coalesce(v_filtres ->> 'sort', 'title');
	v_sens := coalesce(v_filtres ->> 'direction',
	                   case v_tri when 'amount' then 'desc' when 'created_at' then 'desc' else 'asc' end);

	-- Les lignes, dans l'ordre de la vue liste, rassemblées une fois : le plafond se compte avant tout journal.
	select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - 'rang' order by x.rang), '[]'::jsonb)
	  into v_lignes
	  from (
	select a.id as card_id, a.title,
	       (select pg_catalog.string_agg(l.name, ', ' order by pg_catalog.lower(l.name), l.id)
	          from public.card_labels cl join public.labels l on l.id = cl.label_id
	         where cl.card_id = a.id) as labels,
	       pr.full_name as owner_name, n.label as step_label, p.amount, a.currency, p.next_action, p.next_action_at,
	       t.slug as track_slug, ch.slug as channel_slug,
	       pg_catalog.row_number() over (
	           order by
	               case when v_tri = 'title' and v_sens = 'asc' then a.title end asc nulls last,
	               case when v_tri = 'title' and v_sens = 'desc' then a.title end desc nulls last,
	               case when v_tri = 'amount' and v_sens = 'asc' then p.amount end asc nulls last,
	               case when v_tri = 'amount' and v_sens = 'desc' then p.amount end desc nulls last,
	               case when v_tri = 'next_action_at' and v_sens = 'asc' then p.next_action_at end asc nulls last,
	               case when v_tri = 'next_action_at' and v_sens = 'desc' then p.next_action_at end desc nulls last,
	               case when v_tri = 'created_at' and v_sens = 'asc' then a.created_at end asc nulls last,
	               case when v_tri = 'created_at' and v_sens = 'desc' then a.created_at end desc nulls last,
	               a.title asc, a.id asc) as rang
	  from public.card_placements p
	  join public.cards a on a.id = p.card_id
	  join public.channels ch on ch.id = p.channel_id
	  join public.tracks t on t.id = ch.track_id
	  left join public.workflow_steps s on s.id = p.current_step_id
	  left join public.workflow_nodes_catalog n on n.id = s.node_id
	  left join public.profiles pr on pr.id = p.owner_id
	 where p.channel_id = p_channel
	   and p.archived_at is null
	   and a.deleted_at is null
	   and (v_filtres ->> 'step_id' is null or p.current_step_id = (v_filtres ->> 'step_id')::uuid)
	   and (v_filtres ->> 'label_id' is null or exists (
	        select 1 from public.card_labels cl where cl.card_id = a.id and cl.label_id = (v_filtres ->> 'label_id')::uuid))
	   and (v_filtres ->> 'search' is null
	        or a.search_tsv @@ pg_catalog.plainto_tsquery('app.francais_sans_accent'::regconfig, v_filtres ->> 'search'))
	   and (v_filtres ->> 'snoozed' = 'shown' or p.snoozed_until is null or p.snoozed_until <= pg_catalog.now())
	  ) x;

	v_nombre := pg_catalog.jsonb_array_length(v_lignes);
	if v_nombre > 5000 then
		raise exception 'export_too_large' using errcode = '22023';
	end if;
	perform app.audit_export(v_espace, 'card_list', v_nombre,
	                         pg_catalog.jsonb_build_object('channel_id', p_channel, 'filters', v_filtres));

	return query
	select r.card_id, r.title, r.labels, r.owner_name, r.step_label, r.amount, r.currency, r.next_action, r.next_action_at,
	       r.track_slug, r.channel_slug
	  from rows from (pg_catalog.jsonb_to_recordset(v_lignes) as (
	       card_id uuid, title text, labels text, owner_name text, step_label text, amount numeric, currency text,
	       next_action text, next_action_at timestamptz, track_slug text, channel_slug text))
	       with ordinality as r(card_id, title, labels, owner_name, step_label, amount, currency, next_action,
	                            next_action_at, track_slug, channel_slug, ordre)
	 order by r.ordre;
end;
$$;

-- =============================================================================================
-- 3. L'export du carnet — §5.1, §5.2
-- =============================================================================================

create or replace function public.export_contacts(p_workspace uuid)
returns table (
	contact_id uuid, full_name text, email text, phone text, role_title text, organization_name text,
	organization_domain text, created_at timestamptz, anonymized_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	v_nombre integer;
begin
	-- L'espace, lu sous la RLS de la personne : un espace dont elle n'est pas membre n'existe pas pour elle.
	if not exists (select 1 from public.workspaces w where w.id = p_workspace) then
		raise exception 'workspace_not_found' using errcode = 'P0002';
	end if;
	select pg_catalog.count(*)::integer into v_nombre from public.contacts c where c.workspace_id = p_workspace;
	if v_nombre > 5000 then
		raise exception 'export_too_large' using errcode = '22023';
	end if;
	perform app.audit_export(p_workspace, 'contact_list', v_nombre, '{}'::jsonb);
	return query
	select c.id, c.full_name, c.email, c.phone, c.role_title, o.name, o.domain, c.created_at, c.anonymized_at
	  from public.contacts c
	  left join public.organizations o on o.id = c.organization_id
	 where c.workspace_id = p_workspace
	 order by pg_catalog.lower(c.full_name), c.id;
end;
$$;

revoke all on function public.export_cards(uuid, jsonb) from public, anon;
revoke all on function public.export_contacts(uuid) from public, anon;
grant execute on function public.export_cards(uuid, jsonb) to authenticated, service_role;
grant execute on function public.export_contacts(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
