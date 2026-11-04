-- @spec CRM-112 (docs/BACKLOG.md) — tranche T4.d.1 : les filtres des champs de l'affaire retenus par une vue sauvegardée et
--       appliqués par l'export CSV — la forme `common_fields` validée, son interprétation en base, `export_cards`
-- @spec docs/SPEC-champs-communs.md §8 (précision T4.d) ; docs/SPEC-vues-import-export.md §2.2 ; docs/SCHEMA.md « Migration
--       `0165` » ; docs/JOURNAL.md décisions 837 et 838
--
-- `app.saved_view_filters_valid` et `public.export_cards` SONT REPRISES À L'IDENTIQUE DE LEUR DÉFINITION EN BASE
-- (`pg_get_functiondef`), chacune avec un seul ajout : deux clés de plus pour la première, la condition des filtres de
-- champ et le contrôle du fuseau pour la seconde.

-- --- 1. La forme d'un filtre de champ -------------------------------------------------------------------------------
-- Une seule des cinq formes de §8 (précision T4.d) ; le type du champ n'est pas connu ici : la correspondance entre la forme
-- et le type se juge à l'interprétation, où une forme qui ne convient pas au type est ignorée.
create or replace function app.common_field_filter_shape_valid(p_filtre jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
	select pg_catalog.jsonb_typeof(p_filtre) = 'object'
	   and (
	       -- contient
	       (p_filtre ? 'contains' and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_filtre)) = 1
	        and pg_catalog.jsonb_typeof(p_filtre -> 'contains') = 'string'
	        and pg_catalog.char_length(p_filtre ->> 'contains') between 1 and 200)
	       -- l'un des choix
	    or (p_filtre ? 'any_of' and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_filtre)) = 1
	        and pg_catalog.jsonb_typeof(p_filtre -> 'any_of') = 'array'
	        and pg_catalog.jsonb_array_length(p_filtre -> 'any_of') between 1 and 50
	        and not exists (select 1 from pg_catalog.jsonb_array_elements(p_filtre -> 'any_of') e
	                         where pg_catalog.jsonb_typeof(e) <> 'string'))
	       -- entre deux nombres, l'un au moins
	    or ((p_filtre ? 'min' or p_filtre ? 'max')
	        and not exists (select 1 from pg_catalog.jsonb_object_keys(p_filtre) k where k not in ('min', 'max'))
	        and coalesce(pg_catalog.jsonb_typeof(p_filtre -> 'min'), 'null') in ('number', 'null')
	        and coalesce(pg_catalog.jsonb_typeof(p_filtre -> 'max'), 'null') in ('number', 'null')
	        and coalesce(pg_catalog.jsonb_typeof(p_filtre -> 'min'), 'null') || coalesce(pg_catalog.jsonb_typeof(p_filtre -> 'max'), 'null') <> 'nullnull')
	       -- entre deux jours, l'un au moins
	    or ((p_filtre ? 'from' or p_filtre ? 'to')
	        and not exists (select 1 from pg_catalog.jsonb_object_keys(p_filtre) k where k not in ('from', 'to'))
	        and (coalesce(pg_catalog.jsonb_typeof(p_filtre -> 'from'), 'null') = 'null'
	             or (p_filtre ->> 'from') ~ '^\d{4}-\d{2}-\d{2}$')
	        and (coalesce(pg_catalog.jsonb_typeof(p_filtre -> 'to'), 'null') = 'null'
	             or (p_filtre ->> 'to') ~ '^\d{4}-\d{2}-\d{2}$')
	        and coalesce(p_filtre ->> 'from', p_filtre ->> 'to') is not null)
	       -- une case
	    or (p_filtre ? 'is' and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_filtre)) = 1
	        and p_filtre ->> 'is' in ('yes', 'no', 'empty'))
	   );
$$;
alter function app.common_field_filter_shape_valid(jsonb) owner to postgres;
grant execute on function app.common_field_filter_shape_valid(jsonb) to authenticated, service_role;

-- --- 2. La validation d'une vue : deux clés de plus ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.saved_view_filters_valid(p_filters jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
	select pg_catalog.jsonb_typeof(p_filters) = 'object'
	   and not exists (
	       select 1 from pg_catalog.jsonb_object_keys(p_filters) k
	        where k not in ('sort', 'direction', 'step_id', 'label_id', 'search', 'snoozed', 'common_fields', 'time_zone'))
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
	   and (not p_filters ? 'snoozed' or p_filters ->> 'snoozed' in ('hidden', 'shown'))
	   -- `CRM-112` T4.d : les filtres de champ, 50 au plus, chacun par la clé d'un champ et dans l'une des cinq formes.
	   and (not p_filters ? 'common_fields'
	        or (pg_catalog.jsonb_typeof(p_filters -> 'common_fields') = 'object'
	            and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_filters -> 'common_fields')) <= 50
	            and not exists (
	                select 1 from pg_catalog.jsonb_each(p_filters -> 'common_fields') f
	                 where f.key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or not app.common_field_filter_shape_valid(f.value))))
	   -- Le fuseau : la forme d'un nom IANA ; son existence se contrôle à l'emploi (`export_cards`).
	   and (not p_filters ? 'time_zone'
	        or (pg_catalog.jsonb_typeof(p_filters -> 'time_zone') = 'string'
	            and (p_filters ->> 'time_zone') ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$'
	            and pg_catalog.char_length(p_filters ->> 'time_zone') <= 64));
$function$;

-- --- 3. L'interprétation : une affaire passe-t-elle les filtres de champ ? ------------------------------------------
-- `security invoker` : les valeurs sont lues sous la RLS de la personne. Une clé inconnue, archivée, ou dont la forme ne
-- convient pas au type est IGNORÉE, comme l'adresse le fait (§12.2 de `docs/SPEC-cards.md`). La sémantique est celle de
-- l'écran (`webapp/src/lib/liste-cards.ts`, `lirePageCards`) : un texte contenu sans casse ni accents, un choix parmi des
-- clés, des bornes incluses, des jours lus dans le fuseau, une case oui, non ou vide.
create or replace function app.card_common_filters_match(p_card uuid, p_filters jsonb, p_time_zone text default 'UTC')
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
	v_champ  record;
	v_valeur public.card_common_field_values%rowtype;
	v_filtre jsonb;
	v_motif  text;
	v_jour   date;
	v_espace uuid;
begin
	-- Une affaire que la personne ne lit pas ne passe aucun filtre. *Trouvé par la preuve pgTAP `0154`* : sans ce contrôle,
	-- la boucle ne trouvait aucun champ et l'affaire illisible « passait » — sans rien révéler, mais à tort.
	select c.workspace_id into v_espace from public.cards c where c.id = p_card;
	if v_espace is null then
		return false;
	end if;
	if p_filters is null or p_filters = '{}'::jsonb then
		return true;
	end if;
	for v_champ in
		select f.id, f.key, f.type
		  from public.card_common_fields f
		 where f.workspace_id = v_espace and f.archived_at is null and p_filters ? f.key
	loop
		v_filtre := p_filters -> v_champ.key;
		select * into v_valeur from public.card_common_field_values v where v.card_id = p_card and v.field_id = v_champ.id;

		if v_champ.type in ('text', 'textarea', 'email', 'phone', 'url') and v_filtre ? 'contains' then
			v_motif := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
				pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, v_filtre ->> 'contains')),
				'\', '\\'), '%', '\%'), '_', '\_') || '%';
			if v_valeur.value_search is null or v_valeur.value_search not like v_motif then
				return false;
			end if;
		elsif v_champ.type = 'select' and v_filtre ? 'any_of' then
			if v_valeur.value is null or not (v_filtre -> 'any_of') @> v_valeur.value then
				return false;
			end if;
		elsif v_champ.type = 'multiselect' and v_filtre ? 'any_of' then
			if v_valeur.value is null or pg_catalog.jsonb_typeof(v_valeur.value) <> 'array'
			   or not (v_valeur.value ?| array(select pg_catalog.jsonb_array_elements_text(v_filtre -> 'any_of'))) then
				return false;
			end if;
		elsif v_champ.type in ('number', 'money') and (v_filtre ? 'min' or v_filtre ? 'max') then
			if v_valeur.value is null or pg_catalog.jsonb_typeof(v_valeur.value) <> 'number'
			   or (pg_catalog.jsonb_typeof(v_filtre -> 'min') = 'number' and (v_valeur.value #>> '{}')::numeric < (v_filtre ->> 'min')::numeric)
			   or (pg_catalog.jsonb_typeof(v_filtre -> 'max') = 'number' and (v_valeur.value #>> '{}')::numeric > (v_filtre ->> 'max')::numeric) then
				return false;
			end if;
		elsif v_champ.type in ('date', 'datetime') and (v_filtre ? 'from' or v_filtre ? 'to') then
			v_jour := case v_champ.type
				when 'date' then v_valeur.value_date
				else (v_valeur.value_timestamp at time zone coalesce(p_time_zone, 'UTC'))::date
			end;
			if v_jour is null
			   or (v_filtre ->> 'from' is not null and v_jour < (v_filtre ->> 'from')::date)
			   or (v_filtre ->> 'to' is not null and v_jour > (v_filtre ->> 'to')::date) then
				return false;
			end if;
		elsif v_champ.type = 'checkbox' and v_filtre ? 'is' then
			if (v_filtre ->> 'is' = 'yes' and v_valeur.value is distinct from 'true'::jsonb)
			   or (v_filtre ->> 'is' = 'no' and v_valeur.value is distinct from 'false'::jsonb)
			   or (v_filtre ->> 'is' = 'empty' and v_valeur.value is not null and v_valeur.value <> 'null'::jsonb) then
				return false;
			end if;
		end if;
	end loop;
	return true;
end;
$$;
alter function app.card_common_filters_match(uuid, jsonb, text) owner to postgres;
revoke all on function app.card_common_filters_match(uuid, jsonb, text) from public;
grant execute on function app.card_common_filters_match(uuid, jsonb, text) to authenticated, service_role;

comment on function app.card_common_filters_match(uuid, jsonb, text) is
	'CRM-112 T4.d — docs/SPEC-champs-communs.md §8 (précision T4.d) : une affaire passe-t-elle les filtres de champ '
	'(forme structurée common_fields) ; security invoker, une clé inconnue ou une forme hors type est ignorée.';

-- --- 4. L'export : la condition des filtres de champ, et le fuseau contrôlé ------------------------------------------
CREATE OR REPLACE FUNCTION public.export_cards(p_channel uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(card_id uuid, title text, labels text, owner_name text, step_label text, amount numeric, currency text, next_action text, next_action_at timestamp with time zone, track_slug text, channel_slug text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	v_espace   uuid;
	v_filtres  jsonb := coalesce(p_filters, '{}'::jsonb);
	v_tri      text;
	v_sens     text;
	v_lignes   jsonb;
	v_nombre   integer;
	v_fuseau   text;
begin
	if not app.saved_view_filters_valid(v_filtres) then
		raise exception 'invalid_filters' using errcode = '22023';
	end if;
	-- `CRM-112` T4.d : le fuseau d'un champ date et heure ; un nom que PostgreSQL ne connaît pas est refusé.
	v_fuseau := coalesce(v_filtres ->> 'time_zone', 'UTC');
	if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_fuseau) then
		raise exception 'invalid_filters' using errcode = '22023';
	end if;
	-- Le channel, lu sous la RLS de la personne : illisible et inexistant se confondent.
	select c.workspace_id into v_espace from public.channels c where c.id = p_channel and c.deleted_at is null;
	if v_espace is null then
		perform app.raise_http_error(404, 'channel_not_found');
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
	   -- `CRM-112` T4.d : les filtres de champ, interprétés comme à l'écran.
	   and (not v_filtres ? 'common_fields' or app.card_common_filters_match(a.id, v_filtres -> 'common_fields', v_fuseau))
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
$function$;
