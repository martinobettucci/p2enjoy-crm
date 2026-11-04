-- @spec CRM-112 (docs/BACKLOG.md) — tranche T4.c : les filtres de champ personne, contact et fichier — `filled` pour la
--       forme `is`, les trois types dans l'interprétation
-- @spec docs/SPEC-champs-communs.md §8 (précision T4.c) ; docs/SCHEMA.md « Migration `0166` » ; docs/JOURNAL.md décision 839
--
-- `app.common_field_filter_shape_valid` et `app.card_common_filters_match` SONT REPRISES À L'IDENTIQUE DE LEUR
-- DÉFINITION DANS LA `0165`, chacune avec un seul ajout : `filled` pour la première, les types `user`, `contact`
-- (comme un choix) et `file` (renseigné ou vide) pour la seconde.

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
	        and p_filtre ->> 'is' in ('yes', 'no', 'empty', 'filled'))
	   );
$$;

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
		elsif v_champ.type in ('select', 'user', 'contact') and v_filtre ? 'any_of' then
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
		elsif v_champ.type = 'file' and v_filtre ->> 'is' in ('filled', 'empty') then
			-- `CRM-112` T4.c : renseigné — ni nulle, ni `null` JSON, ni chaîne vide ; vide — le contraire.
			if (v_filtre ->> 'is' = 'filled') is distinct from (v_valeur.value is not null and v_valeur.value <> 'null'::jsonb
			                                                  and v_valeur.value <> '""'::jsonb) then
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
