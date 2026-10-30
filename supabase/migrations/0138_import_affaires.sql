-- @spec CRM-071 (docs/BACKLOG.md) — tranche T6 : l'import CSV des affaires dans la vue liste d'un channel
-- @spec docs/SPEC-vues-import-export.md §6.1 (simulation puis confirmation), §6.3 (champs, étape posée directement,
--       doublons, refus par ligne), §6.3 bis (en-têtes, responsable, formats, codes d'issue, fil, journal), §6.4, §6.5 ;
--       docs/SCHEMA.md « Migration `0138` » ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décision 778
--
-- MÊME FORME QUE `import_contacts` (0137) : chaque ligne est jugée sous la RLS de la personne (`SECURITY INVOKER`), dans sa
-- sous-transaction ; la simulation joue la même boucle puis annule tout ; les issues vivent dans une variable.
--
-- LE RATTACHEMENT EST POSÉ EN UNE ÉCRITURE, AVEC SES VALEURS : un membre ne peut pas écrire l'étape d'un rattachement, et
-- une mise à jour du responsable après coup écrirait « Responsable modifié » au fil d'une affaire qui vient de naître.

-- =============================================================================================
-- 1. Les lectures de valeurs — §6.3 bis (« Les valeurs »)
-- =============================================================================================

-- Un nombre écrit à la française ou à l'anglaise : espaces (insécables comprises) retirés, virgule décimale, « % » final
-- toléré. Nul quand le texte n'est pas un nombre — l'appelant nomme le champ refusé.
create or replace function app.import_numeric(p_valeur text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
	v text := pg_catalog.regexp_replace(coalesce(p_valeur, ''), '[[:space:] %]', '', 'g');
begin
	v := pg_catalog.replace(v, ',', '.');
	if v !~ '^-?[0-9]+(\.[0-9]+)?$' then
		return null;
	end if;
	return v::numeric;
end;
$$;

-- Une échéance : `AAAA-MM-JJ` ou `JJ/MM/AAAA`, suivie ou non de `HH:MM`, en heure de Paris, une date seule valant 9 h ; ou
-- l'horodatage ISO de l'export, avec son décalage. Nul quand la date n'existe pas (31/02) ou ne se lit pas.
create or replace function app.import_timestamp(p_valeur text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
	v      text := pg_catalog.btrim(coalesce(p_valeur, ''));
	m      text[];
	v_jour date;
	v_heure text;
begin
	if v ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}(:?\d{2})?|Z)$' then
		return v::timestamptz;
	end if;
	m := pg_catalog.regexp_match(v, '^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?$');
	if m is not null then
		v_jour := pg_catalog.make_date(m[1]::integer, m[2]::integer, m[3]::integer);
		v_heure := m[4];
	else
		m := pg_catalog.regexp_match(v, '^(\d{2})/(\d{2})/(\d{4})(?: (\d{2}:\d{2}))?$');
		if m is null then
			return null;
		end if;
		v_jour := pg_catalog.make_date(m[3]::integer, m[2]::integer, m[1]::integer);
		v_heure := m[4];
	end if;
	return (v_jour::text || ' ' || coalesce(v_heure, '09:00'))::timestamp at time zone 'Europe/Paris';
exception
	when datetime_field_overflow or invalid_datetime_format or invalid_text_representation then
		return null;
end;
$$;

revoke all on function app.import_numeric(text) from public, anon;
revoke all on function app.import_timestamp(text) from public, anon;
grant execute on function app.import_numeric(text) to authenticated, service_role;
grant execute on function app.import_timestamp(text) to authenticated, service_role;

-- =============================================================================================
-- 2. Le responsable : un membre, par son email ou son nom complet unique — §6.3 bis
-- =============================================================================================

-- DÉFINISSEUR : `profiles.email` n'a aucun privilège client (0133). La fonction ne répond que pour un espace dont l'appelant
-- est membre, et ne rend qu'un identifiant de membre — jamais une adresse.
create or replace function app.workspace_member_by_contact(p_workspace uuid, p_valeur text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v      text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_valeur, '')));
	v_id   uuid;
	v_nb   integer;
begin
	if v = '' or not app.is_workspace_member(p_workspace) then
		return null;
	end if;
	select m.user_id into v_id
	  from public.workspace_members m join public.profiles p on p.id = m.user_id
	 where m.workspace_id = p_workspace and pg_catalog.lower(p.email) = v
	 limit 1;
	if v_id is not null then
		return v_id;
	end if;
	select count(*), min(m.user_id::text)::uuid into v_nb, v_id
	  from public.workspace_members m join public.profiles p on p.id = m.user_id
	 where m.workspace_id = p_workspace and pg_catalog.lower(pg_catalog.btrim(p.full_name)) = v;
	return case when v_nb = 1 then v_id end;
end;
$$;

alter function app.workspace_member_by_contact(uuid, text) owner to postgres;
revoke all on function app.workspace_member_by_contact(uuid, text) from public, anon;
grant execute on function app.workspace_member_by_contact(uuid, text) to authenticated, service_role;

-- =============================================================================================
-- 3. Le rattachement posé à l'étape nommée — §6.3, §6.3 bis
-- =============================================================================================

-- LES CONTRÔLES D'`app.poser_premier_rattachement` (écriture du channel, affaire sans rattachement), plus l'espace de
-- l'affaire et l'appartenance du responsable ; mais TOUTE étape du workflow du channel est acceptée — un import est une
-- création, pas un déplacement (§6.3) : ni condition de transition, ni événement `moved`.
create or replace function app.place_imported_card(
	p_card uuid, p_channel uuid, p_step uuid, p_owner uuid, p_amount numeric, p_probability numeric, p_next_action text,
	p_next_action_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_channel record;
	v_id      uuid;
begin
	if not app.can_write_channel(p_channel) then
		raise exception 'permission denied for table card_placements' using errcode = '42501';
	end if;
	select c.id, c.workspace_id, c.workflow_id into v_channel from public.channels c where c.id = p_channel;
	if not exists (select 1 from public.cards a where a.id = p_card and a.workspace_id = v_channel.workspace_id) then
		raise exception 'permission denied for table card_placements' using errcode = '42501';
	end if;
	if exists (select 1 from public.card_placements p where p.card_id = p_card) then
		raise exception 'card_already_placed' using errcode = 'P0001';
	end if;
	if not exists (select 1 from public.workflow_steps s where s.id = p_step and s.workflow_id = v_channel.workflow_id) then
		raise exception 'unknown_step' using errcode = '22023';
	end if;
	if p_owner is not null and not exists (
	       select 1 from public.workspace_members m where m.workspace_id = v_channel.workspace_id and m.user_id = p_owner) then
		raise exception 'not_a_member' using errcode = '22023';
	end if;
	insert into public.card_placements (workspace_id, card_id, channel_id, workflow_id, current_step_id, owner_id, amount,
	                                    probability_override, next_action, next_action_at, created_by)
	values (v_channel.workspace_id, p_card, p_channel, v_channel.workflow_id, p_step, p_owner, p_amount, p_probability,
	        p_next_action, p_next_action_at, (select pr.id from public.profiles pr where pr.id = auth.uid()))
	returning id into v_id;
	return v_id;
end;
$$;

alter function app.place_imported_card(uuid, uuid, uuid, uuid, numeric, numeric, text, timestamptz) owner to postgres;
revoke all on function app.place_imported_card(uuid, uuid, uuid, uuid, numeric, numeric, text, timestamptz) from public, anon;
grant execute on function app.place_imported_card(uuid, uuid, uuid, uuid, numeric, numeric, text, timestamptz)
	to authenticated, service_role;

-- =============================================================================================
-- 4. Le fil : « Affaire créée par import » — §6.3 bis
-- =============================================================================================

-- Redéfinie à l'identique de la 0134, plus `source` quand l'écriture vient d'un import : `import_cards` pose le réglage
-- `app.card_creation_source`, local à sa transaction. Une création ordinaire garde son `payload` d'avant, sans clé de plus.
create or replace function app.card_placements_evenement_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not exists (select 1 from public.card_placements p where p.card_id = new.card_id and p.id <> new.id) then
		perform app.card_event_ecrire(new.card_id, new.workspace_id, 'created',
			pg_catalog.jsonb_build_object(
				'title',      (select c.title from public.cards c where c.id = new.card_id),
				'channel_id', new.channel_id,
				'step_id',    new.current_step_id)
			|| case when pg_catalog.current_setting('app.card_creation_source', true) = 'import'
			        then pg_catalog.jsonb_build_object('source', 'import') else '{}'::jsonb end);
	end if;
	return null;
end;
$$;

-- =============================================================================================
-- 5. L'import des affaires — §6.3, §6.3 bis, §6.5
-- =============================================================================================

create or replace function public.import_cards(p_channel uuid, p_rows jsonb, p_dry_run boolean default true)
returns table (line integer, outcome text, code text, card_id uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	v_channel     record;
	v_initiale    uuid;
	v_issues      jsonb := '[]'::jsonb;
	v_ligne       jsonb;
	v_rang        integer := 0;
	v_titre       text;
	v_etape_nom   text;
	v_etape       uuid;
	v_resp_brut   text;
	v_resp        uuid;
	v_montant_brut text;
	v_montant     numeric;
	v_devise      text;
	v_proba_brut  text;
	v_proba       numeric;
	v_action      text;
	v_echeance_brut text;
	v_echeance    timestamptz;
	v_contact_brut text;
	v_contact     uuid;
	v_affaire     uuid;
	v_issue       text;
	v_code        text;
	v_crees       integer := 0;
	v_ignores     integer := 0;
	v_refuses     integer := 0;
begin
	if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
		raise exception 'invalid_rows' using errcode = '22023';
	end if;
	if pg_catalog.jsonb_array_length(p_rows) > 1000 then
		raise exception 'import_too_large' using errcode = '22023';
	end if;
	-- Le channel, lu sous la RLS de la personne : illisible et inexistant se confondent.
	select c.id, c.workspace_id, c.workflow_id, c.archived_at, c.deleted_at into v_channel
	  from public.channels c where c.id = p_channel;
	if not found then
		raise exception 'channel_not_found' using errcode = 'P0002';
	end if;
	if v_channel.archived_at is not null or v_channel.deleted_at is not null then
		raise exception 'channel_closed' using errcode = 'P0001';
	end if;
	select s.id into v_initiale from public.workflow_steps s
	 where s.workflow_id = v_channel.workflow_id and s.is_initial order by s.position limit 1;

	perform pg_catalog.set_config('app.card_creation_source', 'import', true);
	begin
		for v_ligne in select e.value from pg_catalog.jsonb_array_elements(p_rows) e loop
			v_rang := v_rang + 1;
			v_titre := nullif(pg_catalog.btrim(v_ligne ->> 'title'), '');
			v_etape_nom := nullif(pg_catalog.lower(pg_catalog.btrim(v_ligne ->> 'step')), '');
			v_resp_brut := nullif(pg_catalog.btrim(v_ligne ->> 'owner'), '');
			v_montant_brut := nullif(pg_catalog.btrim(v_ligne ->> 'amount'), '');
			v_devise := nullif(pg_catalog.upper(pg_catalog.btrim(v_ligne ->> 'currency')), '');
			v_proba_brut := nullif(pg_catalog.btrim(v_ligne ->> 'probability'), '');
			v_action := nullif(pg_catalog.btrim(v_ligne ->> 'next_action'), '');
			v_echeance_brut := nullif(pg_catalog.btrim(v_ligne ->> 'next_action_at'), '');
			v_contact_brut := nullif(pg_catalog.lower(pg_catalog.btrim(v_ligne ->> 'contact_email')), '');
			v_etape := v_initiale;
			v_resp := null;
			v_montant := app.import_numeric(v_montant_brut);
			v_proba := app.import_numeric(v_proba_brut);
			v_echeance := app.import_timestamp(v_echeance_brut);
			v_contact := null;
			v_affaire := null;
			v_issue := 'refused';
			v_code := null;
			if v_etape_nom is not null then
				select s.id into v_etape
				  from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
				 where s.workflow_id = v_channel.workflow_id
				   and v_etape_nom in (pg_catalog.lower(pg_catalog.btrim(coalesce(s.label_override, n.label))),
				                       pg_catalog.lower(pg_catalog.btrim(n.label)))
				 order by s.position limit 1;
			end if;
			if v_resp_brut is not null then
				v_resp := app.workspace_member_by_contact(v_channel.workspace_id, v_resp_brut);
			end if;
			if v_contact_brut is not null then
				select c.id into v_contact from public.contacts c
				 where c.workspace_id = v_channel.workspace_id and pg_catalog.lower(c.email) = v_contact_brut limit 1;
			end if;

			-- Les refus se nomment dans l'ordre des colonnes de l'écran ; le doublon ne se juge que sur une ligne recevable.
			if v_titre is null then
				v_code := 'title_required';
			elsif v_etape is null then
				v_code := 'unknown_step';
			elsif v_resp_brut is not null and v_resp is null then
				v_code := 'not_a_member';
			elsif v_montant_brut is not null and v_montant is null then
				v_code := 'invalid_amount';
			elsif v_devise is not null and v_devise !~ '^[A-Z]{3}$' then
				v_code := 'invalid_currency';
			elsif v_proba_brut is not null and (v_proba is null or v_proba < 0 or v_proba > 100) then
				v_code := 'invalid_probability';
			elsif v_echeance_brut is not null and v_echeance is null then
				v_code := 'invalid_date';
			elsif v_contact_brut is not null and v_contact is null then
				v_code := 'unknown_contact';
			elsif exists (
			      select 1 from public.card_placements p join public.cards a on a.id = p.card_id
			       where p.channel_id = p_channel and a.deleted_at is null
			         and pg_catalog.lower(pg_catalog.btrim(a.title)) = pg_catalog.lower(v_titre)) then
				v_issue := 'skipped';
				v_code := 'duplicate_title';
			else
				begin
					-- L'identifiant est tiré avant l'insertion, comme dans `creer_affaire` : un `returning` relirait l'affaire
					-- sous la politique de lecture, qui ne la rend qu'une fois son rattachement posé.
					v_affaire := pg_catalog.gen_random_uuid();
					insert into public.cards (id, workspace_id, title, currency, created_by)
					values (v_affaire, v_channel.workspace_id, v_titre, coalesce(v_devise, 'EUR'), auth.uid());
					perform app.place_imported_card(v_affaire, p_channel, v_etape, v_resp, v_montant, v_proba, v_action,
					                                v_echeance);
					if v_contact is not null then
						insert into public.card_contacts (workspace_id, card_id, contact_id)
						values (v_channel.workspace_id, v_affaire, v_contact);
					end if;
					v_issue := 'created';
				exception
					when insufficient_privilege then
						v_code := 'forbidden';
						v_affaire := null;
					when others then
						v_code := 'unknown';
						v_affaire := null;
				end;
			end if;
			if v_issue = 'created' then
				v_crees := v_crees + 1;
			elsif v_issue = 'skipped' then
				v_ignores := v_ignores + 1;
			else
				v_refuses := v_refuses + 1;
			end if;
			v_issues := v_issues || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
				'line', v_rang, 'outcome', v_issue, 'code', v_code, 'card_id', v_affaire));
		end loop;
		if p_dry_run then
			raise exception 'dry_run' using errcode = 'ZZ071';
		end if;
	exception
		when sqlstate 'ZZ071' then
			null;
	end;
	perform pg_catalog.set_config('app.card_creation_source', '', true);

	if not p_dry_run then
		perform app.audit_import(v_channel.workspace_id, 'card', pg_catalog.jsonb_build_object(
			'created', v_crees, 'skipped', v_ignores, 'refused', v_refuses, 'channel_id', p_channel));
	end if;

	return query
	select r.line, r.outcome, r.code, r.card_id
	  from pg_catalog.jsonb_to_recordset(v_issues) as r(line integer, outcome text, code text, card_id uuid)
	 order by r.line;
end;
$$;

revoke all on function public.import_cards(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_cards(uuid, jsonb, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
