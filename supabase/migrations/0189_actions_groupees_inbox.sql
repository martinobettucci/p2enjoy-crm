-- @spec CRM-156 (docs/BACKLOG.md) — tranche T1 : la base des actions groupées de l'inbox — la portée calculée en base,
--       le compte avant d'agir, l'action par paquets qui passe chaque message par la fonction unitaire et rend faits et refus
-- @spec docs/SPEC-mail-subsystem.md §32.2 (la portée), §32.3 (le filtre explicite, tenu par la base), §32.4 (compter), §32.5 bis (les paquets),
--       §32.5 (agir) ; docs/SCHEMA.md « Migration `0189` » ;
--       docs/JOURNAL.md décisions 944, 946 et 949 ; CLAUDE.md §10 (la règle tenue en base)
--
-- AUCUNE TABLE, AUCUNE COLONNE : trois fonctions. Les règles de chaque action restent dans SA fonction unitaire, que
-- l'action groupée appelle message par message (ou fil par fil, pour le sommeil) : une copie des gardes pourrait
-- diverger, un appel ne le peut pas (décision 944, « les mêmes règles que l'action unitaire »).
--
-- IDEMPOTENCE : `create or replace` partout.

-- =============================================================================================
-- 1. La portée — §32.2, §32.3
-- =============================================================================================

-- Valide la description et rend les messages qu'elle désigne, PARMI CEUX QUE L'APPELANT VOIT. Le juge de visibilité est
-- celui des actions unitaires : `app.peut_voir_message` hors corbeille, `app.message_en_corbeille_visible` dedans. La
-- fonction est `SECURITY DEFINER` (la RLS ne s'applique donc pas) : chaque message passe EXPLICITEMENT par ce juge.
create or replace function app.inbox_scope_messages(p_scope jsonb)
returns table (message_id uuid, workspace_id uuid, thread_key text, direction text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_dossier   text;
	v_card      uuid;
	v_moi       boolean;
	v_pastilles uuid[];
	v_expediteur text;
	v_sommeil   text;
	v_fils      jsonb;
	v_messages  uuid[];
begin
	if p_scope is null or pg_catalog.jsonb_typeof(p_scope) <> 'object' then
		raise exception 'invalid_scope' using errcode = '22023';
	end if;

	-- LA LECTURE DES CHAMPS : une valeur d'un mauvais type (un identifiant mal formé, un tableau qui n'en est pas un)
	-- lève une erreur de la classe 22 ; elle devient `invalid_scope`, et seulement elle.
	begin
		v_dossier := p_scope ->> 'folder';
		v_card := (p_scope ->> 'card_id')::uuid;
		v_moi := coalesce((p_scope ->> 'only_me')::boolean, false);
		v_pastilles := coalesce(
			(select pg_catalog.array_agg(e::uuid) from pg_catalog.jsonb_array_elements_text(
				case when p_scope ? 'label_ids' and pg_catalog.jsonb_typeof(p_scope -> 'label_ids') <> 'null'
				     then p_scope -> 'label_ids' else '[]'::jsonb end) e),
			'{}'::uuid[]);
		v_expediteur := nullif(pg_catalog.lower(pg_catalog.btrim(p_scope ->> 'sender')), '');
		v_sommeil := coalesce(p_scope ->> 'snoozed', 'hidden');
		v_fils := case when pg_catalog.jsonb_typeof(p_scope -> 'threads') = 'array' then p_scope -> 'threads' end;
		if p_scope ? 'threads' and pg_catalog.jsonb_typeof(p_scope -> 'threads') not in ('array', 'null') then
			raise exception 'invalid_scope' using errcode = '22023';
		end if;
		if v_fils is not null and exists (
			select 1 from pg_catalog.jsonb_array_elements(v_fils) f
			 where pg_catalog.jsonb_typeof(f) <> 'object'
			    or (f ->> 'workspace_id') is null or (f ->> 'thread_key') is null
			    or ((f ->> 'workspace_id')::uuid) is null
		) then
			raise exception 'invalid_scope' using errcode = '22023';
		end if;
		if pg_catalog.jsonb_typeof(p_scope -> 'message_ids') = 'array' then
			select coalesce(pg_catalog.array_agg(e::uuid), '{}'::uuid[]) into v_messages
			  from pg_catalog.jsonb_array_elements_text(p_scope -> 'message_ids') e;
		end if;
	exception when data_exception then
		raise exception 'invalid_scope' using errcode = '22023';
	end;

	if v_dossier is null or v_dossier not in ('unclassified', 'card', 'trash')
	   or (v_dossier = 'card' and v_card is null)
	   or (v_dossier = 'trash' and v_messages is null)
	   or v_sommeil not in ('hidden', 'shown') then
		raise exception 'invalid_scope' using errcode = '22023';
	end if;

	-- §32.3 — « TOUT LE FILTRE » EXIGE UN FILTRE EXPLICITE : une pastille, « Seulement moi » appliqué, un expéditeur. Le
	-- dossier seul ne suffit pas, ni le mode de sommeil. La corbeille n'a pas de « tout » : elle exige `message_ids`.
	if v_dossier <> 'trash' and v_fils is null
	   and not (v_moi or pg_catalog.cardinality(v_pastilles) > 0 or v_expediteur is not null) then
		raise exception 'filter_required' using errcode = '22023';
	end if;

	if v_dossier = 'trash' then
		return query
		select m.id, m.workspace_id, app.cle_fil(m.references_ids, m.rfc822_message_id), m.direction
		  from public.mail_messages m
		 where m.id = any (v_messages)
		   and app.message_en_corbeille_visible(m);
		return;
	end if;

	return query
	select m.id, m.workspace_id, app.cle_fil(m.references_ids, m.rfc822_message_id), m.direction
	  from public.mail_messages m
	 where m.deleted_at is null
	   and (case when v_dossier = 'unclassified' then m.card_id is null else m.card_id = v_card end)
	   and (not v_moi or public.concerns_me(m))
	   and (pg_catalog.cardinality(v_pastilles) = 0 or exists (
			select 1 from public.mail_message_labels ml
			 where ml.message_id = m.id and ml.applied and ml.label_id = any (v_pastilles)))
	   and (v_expediteur is null or pg_catalog.lower(pg_catalog.btrim(m.from_address)) = v_expediteur)
	   and (v_sommeil = 'shown' or not exists (
			select 1 from public.mail_thread_snoozes s
			 where s.workspace_id = m.workspace_id
			   and s.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id)
			   and s.snoozed_until > pg_catalog.now()))
	   and (v_fils is null or exists (
			select 1 from pg_catalog.jsonb_array_elements(v_fils) f
			 where (f ->> 'workspace_id')::uuid = m.workspace_id
			   and f ->> 'thread_key' = app.cle_fil(m.references_ids, m.rfc822_message_id)))
	   and app.peut_voir_message(m.id);
end;
$$;

comment on function app.inbox_scope_messages(jsonb) is
	'CRM-156 §32.2 — la portée d''une action groupée : valide la description (invalid_scope, filter_required) et rend les '
	'messages qu''elle désigne parmi ceux que l''appelant voit (peut_voir_message ; dans la corbeille, '
	'message_en_corbeille_visible).';

revoke all on function app.inbox_scope_messages(jsonb) from public, anon, authenticated;

-- =============================================================================================
-- 2. Compter avant d'agir — §32.4
-- =============================================================================================

create or replace function public.inbox_bulk_count(p_scope jsonb)
returns table (thread_count integer, message_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	return query
	select pg_catalog.count(distinct (p.workspace_id, p.thread_key))::integer, pg_catalog.count(*)::integer
	  from app.inbox_scope_messages(p_scope) p;
end;
$$;

comment on function public.inbox_bulk_count(jsonb) is
	'CRM-156 §32.4 — le nombre de fils et de messages d''une portée, annoncé avant d''agir. Mêmes refus que '
	'inbox_bulk_apply.';

revoke all on function public.inbox_bulk_count(jsonb) from public, anon;
grant execute on function public.inbox_bulk_count(jsonb) to authenticated;

-- =============================================================================================
-- 3. Agir — §32.5
-- =============================================================================================

-- Le code d'un refus NOMMÉ levé par une fonction unitaire, ou `null` pour toute autre erreur. `app.raise_http_error`
-- lève `PGRST` avec un message JSON (`{"code": ..., "message": "<code>"}`) ; les autres lèvent leur code en message.
create or replace function app.code_refus_unitaire(p_sqlstate text, p_message text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
	v_code text := p_message;
begin
	if p_sqlstate = 'PGRST' then
		begin
			v_code := p_message::jsonb ->> 'message';
		exception when others then
			return null;
		end;
	end if;
	-- LA LISTE FERMÉE des refus que les fonctions unitaires nomment (§32.5). Un code hors de cette liste est une panne :
	-- l'appel entier échoue, et rien n'est écrit.
	if v_code in ('forbidden', 'message_not_found', 'card_not_available', 'no_writable_mailbox', 'label_not_found',
	              'label_archived', 'outbound_message', 'thread_not_found', 'snooze_date_in_past',
	              'snooze_date_required') then
		return v_code;
	end if;
	return null;
end;
$$;

revoke all on function app.code_refus_unitaire(text, text) from public, anon, authenticated;

-- LE PAQUET (§32.5 bis, décision 949) : 2 000 messages au plus — 2 000 fils pour le sommeil —, pris dans l'ordre de leur
-- identifiant, après le curseur `after` de la description ; l'appel rend `next`, le curseur du paquet suivant, nul après
-- le dernier. MESURÉ : supprimer 5 000 messages en un appel prend 8,2 s, au-delà du délai de 8 s du rôle `authenticated` ;
-- un paquet de 2 000 en prend environ 3,3. Le curseur suit l'identifiant, non un rang : un message qu'un paquet a classé
-- ou supprimé quitte la portée sans décaler les suivants.
create or replace function public.inbox_bulk_apply(p_scope jsonb, p_action text, p_argument jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	c_paquet   constant integer := 2000;
	v_dossier  text;
	v_card     uuid;
	v_jusqua   timestamptz;
	v_pastille uuid;
	v_posee    boolean;
	v_boite    boolean;
	v_apres_m  uuid;
	v_apres_w  uuid;
	v_apres_f  text;
	v_suivant  jsonb;
	v_fils     integer := 0;
	v_nombre   integer := 0;
	v_faits    integer := 0;
	v_refus    jsonb := '{}'::jsonb;
	v_code     text;
	v_etat     text;
	v_msg      text;
	v_ligne    record;
	v_lot      uuid[];
	v_par_fil  boolean;
begin
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	v_dossier := p_scope ->> 'folder';

	-- --- L'action et son argument, avant toute lecture --------------------------------------------------------------
	if p_action is null or p_action not in ('classify', 'unclassify', 'delete', 'restore', 'mark_read', 'mark_unread',
	                                        'snooze', 'wake', 'set_label', 'request_label_evaluation') then
		raise exception 'invalid_action' using errcode = '22023';
	end if;
	v_par_fil := p_action in ('snooze', 'wake');
	begin
		if p_action = 'classify' then
			v_card := (p_argument ->> 'card_id')::uuid;
			if v_card is null then raise exception 'invalid_action' using errcode = '22023'; end if;
		elsif p_action = 'snooze' then
			v_jusqua := (p_argument ->> 'until')::timestamptz;
			if v_jusqua is null then raise exception 'invalid_action' using errcode = '22023'; end if;
		elsif p_action = 'set_label' then
			v_pastille := (p_argument ->> 'label_id')::uuid;
			v_posee := (p_argument ->> 'applied')::boolean;
			if v_pastille is null or v_posee is null then raise exception 'invalid_action' using errcode = '22023'; end if;
		elsif p_action = 'delete' then
			v_boite := coalesce((p_argument ->> 'also_mailbox')::boolean, false);
		end if;
	exception when data_exception then
		raise exception 'invalid_action' using errcode = '22023';
	end;

	-- --- Le curseur : un identifiant de message, ou, pour le sommeil, le couple [workspace_id, thread_key] -------------
	begin
		if pg_catalog.jsonb_typeof(p_scope -> 'after') is not null and pg_catalog.jsonb_typeof(p_scope -> 'after') <> 'null' then
			if v_par_fil then
				if pg_catalog.jsonb_typeof(p_scope -> 'after') <> 'array' or pg_catalog.jsonb_array_length(p_scope -> 'after') <> 2
				   or (p_scope -> 'after' ->> 1) is null then
					raise exception 'invalid_scope' using errcode = '22023';
				end if;
				v_apres_w := (p_scope -> 'after' ->> 0)::uuid;
				v_apres_f := p_scope -> 'after' ->> 1;
			else
				if pg_catalog.jsonb_typeof(p_scope -> 'after') <> 'string' then
					raise exception 'invalid_scope' using errcode = '22023';
				end if;
				v_apres_m := (p_scope ->> 'after')::uuid;
			end if;
		end if;
	exception when data_exception then
		raise exception 'invalid_scope' using errcode = '22023';
	end;

	-- --- La portée (ses refus : invalid_scope, filter_required) -------------------------------------------------------
	-- Les tables de travail vivent le temps de la transaction ; un second appel dans la même transaction les vide.
	if pg_catalog.to_regclass('pg_temp.inbox_bulk_portee') is null then
		create temp table inbox_bulk_portee (message_id uuid, workspace_id uuid, thread_key text, direction text)
			on commit drop;
		create temp table inbox_bulk_paquet (message_id uuid, workspace_id uuid, thread_key text, direction text)
			on commit drop;
		create temp table inbox_bulk_fils (workspace_id uuid, thread_key text) on commit drop;
	end if;
	truncate pg_temp.inbox_bulk_portee, pg_temp.inbox_bulk_paquet, pg_temp.inbox_bulk_fils;
	insert into pg_temp.inbox_bulk_portee select * from app.inbox_scope_messages(p_scope);

	-- §32.5 point 4 — ce qui se fait où : restaurer dans la corbeille seulement, et rien d'autre dans la corbeille ;
	-- déclasser dans une affaire seulement.
	if (p_action = 'restore') <> (v_dossier = 'trash')
	   or (p_action = 'unclassify' and v_dossier <> 'card') then
		raise exception 'action_not_allowed_here' using errcode = '22023';
	end if;

	-- --- Le paquet, et le curseur du suivant ------------------------------------------------------------------------
	if v_par_fil then
		insert into pg_temp.inbox_bulk_fils
		select distinct p.workspace_id, p.thread_key
		  from pg_temp.inbox_bulk_portee p
		 where v_apres_w is null or (p.workspace_id, p.thread_key) > (v_apres_w, v_apres_f)
		 order by 1, 2
		 limit c_paquet + 1;
		if (select pg_catalog.count(*) from pg_temp.inbox_bulk_fils) > c_paquet then
			delete from pg_temp.inbox_bulk_fils f
			 where (f.workspace_id, f.thread_key) = (select g.workspace_id, g.thread_key from pg_temp.inbox_bulk_fils g
			                                          order by g.workspace_id desc, g.thread_key desc limit 1);
			select pg_catalog.jsonb_build_array(f.workspace_id, f.thread_key) into v_suivant
			  from pg_temp.inbox_bulk_fils f order by f.workspace_id desc, f.thread_key desc limit 1;
		end if;
		insert into pg_temp.inbox_bulk_paquet
		select p.* from pg_temp.inbox_bulk_portee p
		  join pg_temp.inbox_bulk_fils f on f.workspace_id = p.workspace_id and f.thread_key = p.thread_key;
	else
		insert into pg_temp.inbox_bulk_paquet
		select p.* from pg_temp.inbox_bulk_portee p
		 where v_apres_m is null or p.message_id > v_apres_m
		 order by p.message_id
		 limit c_paquet + 1;
		if (select pg_catalog.count(*) from pg_temp.inbox_bulk_paquet) > c_paquet then
			delete from pg_temp.inbox_bulk_paquet q
			 where q.message_id = (select r.message_id from pg_temp.inbox_bulk_paquet r order by r.message_id desc limit 1);
			select pg_catalog.to_jsonb(q.message_id::text) into v_suivant
			  from pg_temp.inbox_bulk_paquet q order by q.message_id desc limit 1;
		end if;
	end if;

	select pg_catalog.count(distinct (p.workspace_id, p.thread_key))::integer, pg_catalog.count(*)::integer
	  into v_fils, v_nombre
	  from pg_temp.inbox_bulk_paquet p;

	-- --- Le sommeil porte sur des FILS --------------------------------------------------------------------------------
	if v_par_fil then
		for v_ligne in select f.workspace_id, f.thread_key from pg_temp.inbox_bulk_fils f order by 1, 2 loop
			begin
				if p_action = 'snooze' then
					perform public.snooze_thread(v_ligne.workspace_id, v_ligne.thread_key, v_jusqua);
				else
					perform public.wake_thread(v_ligne.workspace_id, v_ligne.thread_key);
				end if;
				v_faits := v_faits + 1;
			exception when sqlstate '42501' or sqlstate '22023' or sqlstate '23514' or sqlstate 'P0001'
			               or sqlstate 'PGRST' then
				get stacked diagnostics v_etat = returned_sqlstate, v_msg = message_text;
				v_code := app.code_refus_unitaire(v_etat, v_msg);
				if v_code is null then raise; end if;
				v_refus := pg_catalog.jsonb_set(v_refus, array[v_code],
					pg_catalog.to_jsonb(coalesce((v_refus ->> v_code)::integer, 0) + 1));
			end;
		end loop;

	-- --- Lu : par lots de 200, la borne de `mark_messages_read` ------------------------------------------------------
	-- Un message envoyé n'a pas d'état de lecture : il n'est ni fait, ni refusé (§32.5).
	elsif p_action = 'mark_read' then
		for v_lot in
			select pg_catalog.array_agg(q.message_id)
			  from (select p.message_id, (pg_catalog.row_number() over (order by p.message_id) - 1) / 200 as rang
			          from pg_temp.inbox_bulk_paquet p where p.direction = 'inbound') q
			 group by q.rang
		loop
			v_faits := v_faits + public.mark_messages_read(v_lot);
		end loop;

	-- --- Les autres : message par message, par la fonction unitaire ---------------------------------------------------
	else
		for v_ligne in select p.message_id, p.direction from pg_temp.inbox_bulk_paquet p order by p.message_id loop
			if p_action = 'mark_unread' and v_ligne.direction <> 'inbound' then
				continue;
			end if;
			begin
				case p_action
					when 'classify' then perform public.classify_message(v_ligne.message_id, v_card);
					when 'unclassify' then perform public.unclassify_message(v_ligne.message_id);
					when 'delete' then perform public.delete_message(v_ligne.message_id, v_boite);
					when 'restore' then perform public.restore_message(v_ligne.message_id);
					when 'mark_unread' then perform public.mark_message_unread(v_ligne.message_id);
					when 'set_label' then perform public.set_message_label(v_ligne.message_id, v_pastille, v_posee);
					when 'request_label_evaluation' then perform public.request_label_evaluation(v_ligne.message_id);
				end case;
				v_faits := v_faits + 1;
			exception when sqlstate '42501' or sqlstate '22023' or sqlstate '23514' or sqlstate 'P0001'
			               or sqlstate 'PGRST' then
				get stacked diagnostics v_etat = returned_sqlstate, v_msg = message_text;
				v_code := app.code_refus_unitaire(v_etat, v_msg);
				if v_code is null then raise; end if;
				v_refus := pg_catalog.jsonb_set(v_refus, array[v_code],
					pg_catalog.to_jsonb(coalesce((v_refus ->> v_code)::integer, 0) + 1));
			end;
		end loop;
	end if;

	return pg_catalog.jsonb_build_object('threads', v_fils, 'messages', v_nombre, 'done', v_faits, 'refused', v_refus,
	                                     'next', v_suivant);
end;
$$;

comment on function public.inbox_bulk_apply(jsonb, text, jsonb) is
	'CRM-156 §32.5, §32.5 bis — une action groupée, un paquet de 2 000 messages (2 000 fils pour le sommeil) après le '
	'curseur `after` : chaque élément passé par la fonction unitaire dans un bloc qui capte ses refus nommés ; une panne '
	'défait le paquet. Rend threads, messages, done, refused (code -> nombre) et next (le curseur suivant, nul après le '
	'dernier).';

revoke all on function public.inbox_bulk_apply(jsonb, text, jsonb) from public, anon;
grant execute on function public.inbox_bulk_apply(jsonb, text, jsonb) to authenticated;
