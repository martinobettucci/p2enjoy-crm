-- @spec CRM-112 (docs/BACKLOG.md) — tranche T4.b : les colonnes de recherche typées des valeurs communes, posées par la base
-- @spec docs/SPEC-champs-communs.md §8 (précision T4.b) ; docs/SCHEMA.md « Migration `0164` » ; docs/JOURNAL.md décision 831
--
-- Trois colonnes que l'appelant n'écrit jamais (aucun privilège d'écriture ; le déclencheur de validation les pose) :
-- `value_search`, le texte en minuscules sans accents des types texte, pour le filtre « contient » ; `value_date` et
-- `value_timestamp`, la date et l'instant des types date et date-heure. *Motif mesuré* : la validation accepte toute
-- chaîne que PostgreSQL sait convertir — comparer les chaînes JSON ne serait juste que pour l'ISO.
-- `app.card_common_field_values_validate` EST REPRISE À L'IDENTIQUE DE SA DÉFINITION EN BASE (`pg_get_functiondef`), avec
-- un seul ajout : le calcul des trois colonnes.

alter table public.card_common_field_values
	add column if not exists value_search    text,
	add column if not exists value_date      date,
	add column if not exists value_timestamp timestamptz;

comment on column public.card_common_field_values.value_search is
	'CRM-112 T4.b — le texte des types texte, en minuscules et sans accents, posé par la base ; le filtre « contient ».';
comment on column public.card_common_field_values.value_date is
	'CRM-112 T4.b — la date d''un champ de type date, posée par la base ; le filtre « entre deux dates ».';
comment on column public.card_common_field_values.value_timestamp is
	'CRM-112 T4.b — l''instant d''un champ de type date et heure, posé par la base ; le filtre « entre deux dates ».';

-- Le calcul, une fonction pure du type et de la valeur : le déclencheur et la reprise l'emploient tous les deux.
create or replace function app.card_common_value_columns(p_type text, p_value jsonb,
	out value_search text, out value_date date, out value_timestamp timestamptz)
language plpgsql
stable
set search_path = ''
as $$
begin
	if p_value is null or jsonb_typeof(p_value) <> 'string' then
		return;
	end if;
	if p_type in ('text', 'textarea', 'email', 'phone', 'url') then
		value_search := lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_value #>> '{}'));
	elsif p_type = 'date' then
		value_date := (p_value #>> '{}')::date;
	elsif p_type = 'datetime' then
		value_timestamp := (p_value #>> '{}')::timestamptz;
	end if;
end;
$$;
revoke all on function app.card_common_value_columns(text, jsonb) from public;

CREATE OR REPLACE FUNCTION app.card_common_field_values_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_champ public.card_common_fields%rowtype;
begin
	-- Un `field_id` inconnu ou d'un autre espace : le déclencheur passe avant la clé étrangère, le refus est nommé ici.
	select f.* into v_champ from public.card_common_fields f where f.id = new.field_id and f.workspace_id = new.workspace_id;
	if not found then
		raise exception 'invalid_field_value' using detail = format('champ commun %s introuvable', new.field_id);
	end if;
	perform app.validate_field_value(v_champ.type, v_champ.options, v_champ.key, new.value, new.workspace_id);
	-- `CRM-112` T4.b : les colonnes de recherche, toujours recalculées — l'appelant ne les écrit pas.
	select c.value_search, c.value_date, c.value_timestamp
	  into new.value_search, new.value_date, new.value_timestamp
	  from app.card_common_value_columns(v_champ.type, new.value) c;
	new.updated_by := coalesce((select auth.uid()), new.updated_by);
	if tg_op = 'UPDATE' then
		new.created_at := old.created_at;
		new.updated_at := now();
	end if;
	return new;
end;
$function$;

-- La reprise de l'existant, sans passer par le déclencheur (il toucherait `updated_at` et `updated_by`) : un `UPDATE`
-- des seules colonnes neuves ne déclenche pas `card_events_apres_ecriture_valeur_commune` (`update of value`), et le
-- déclencheur de validation est suspendu le temps de la reprise.
alter table public.card_common_field_values disable trigger card_common_field_values_validate;
update public.card_common_field_values v
   set (value_search, value_date, value_timestamp) = (
	select c.value_search, c.value_date, c.value_timestamp
	  from app.card_common_value_columns((select f.type from public.card_common_fields f where f.id = v.field_id), v.value) c);
alter table public.card_common_field_values enable trigger card_common_field_values_validate;

-- LA POLITIQUE DE LECTURE DES VALEURS, EN SEMI-JOINTURE (décision 831, complément mesuré) : le même droit que
-- `app.can_read_card` — un rattachement de l'affaire dans un channel lisible —, sous la forme de `cards_lecture`. Mesuré :
-- 37,7 → 24,6 ms sur 45 valeurs, et un coût constant (une évaluation de `app.readable_channel_ids()` par requête) au lieu
-- d'un appel de `app.can_read_card` par valeur. L'écriture garde `app.can_write_card`.
drop policy if exists card_common_field_values_select on public.card_common_field_values;
create policy card_common_field_values_select on public.card_common_field_values
	for select to anon, authenticated
	using (card_id in (select p.card_id from public.card_placements p
	                    where p.channel_id in (select unnest(app.readable_channel_ids()))));
