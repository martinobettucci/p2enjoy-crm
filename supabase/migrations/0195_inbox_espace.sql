-- @spec CRM-161 (docs/BACKLOG.md) — tranche T1 : l'inbox d'un espace — la liste, la mention des fils masqués et
--       l'arborescence prennent l'espace en tête, obligatoire ; la portée des actions groupées l'exige ; les non-lus de
--       chaque espace pour le menu des espaces
-- @spec docs/SPEC-mail-subsystem.md §35.2 à §35.4 ; docs/SPEC-espace-courant.md §5, §7 ; docs/SCHEMA.md « Migration
--       `0195` » ; docs/JOURNAL.md décisions 965 et 967 ; CLAUDE.md §10 (la RLS ne change pas)
--
-- LE DÉFAUT (§35.1) : sous la RLS, `inbox_messages`, `inbox_hidden_counts` et `inbox_arborescence` (`0193`) rendaient les
-- messages de TOUS les espaces de l'appelant. Elles prennent maintenant `p_workspace_id` EN TÊTE, sans défaut ; nul, elles
-- lèvent `workspace_required` (22023). Le reste de chaque définition est celui de `0193`, À L'IDENTIQUE, augmenté de la
-- seule condition `m.workspace_id = p_workspace_id`. Ce n'est pas une règle d'accès : la RLS juge toujours chaque ligne ;
-- la fonction restreint ce que l'appelant demande à voir.
--
-- LES ANCIENNES SIGNATURES SONT SUPPRIMÉES : un appel sans espace ne doit plus se résoudre vers une lecture de tous les
-- espaces. Le passage de `language sql` à `plpgsql` tient au seul refus `workspace_required`.
--
-- HORS DE CETTE MIGRATION (§35.7) : `app.card_par_adresse` et le classement d'un mail entrant (`CRM-162` les reprendra) ;
-- `trashed_messages`, déjà cloisonnée ; `search_hidden_mail_counts`, la recherche étant globale.
--
-- IDEMPOTENCE : `drop function if exists` des anciennes signatures, `create or replace` des nouvelles.
-- RETOUR ARRIÈRE : supprimer les quatre fonctions publiques de cette migration, puis rejouer les sections 3, 4, 5 et 6 de
-- `0193` (les anciennes signatures et la portée sans espace), avec la webapp précédente.

-- =============================================================================================
-- 1. La liste de l'inbox — §35.2 (reprise de `0193` §3)
-- =============================================================================================

drop function if exists public.inbox_messages(uuid, boolean, uuid[], text, integer);

create or replace function public.inbox_messages(
	p_workspace_id uuid,
	p_card_id      uuid    default null,
	p_only_me      boolean default false,
	p_label_ids    uuid[]  default '{}',
	p_sender       text    default null,
	p_limit        integer default 50
)
returns setof public.mail_messages
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
	if p_workspace_id is null then
		raise exception 'workspace_required' using errcode = '22023';
	end if;
	return query
	with masques as materialized (
		select t.workspace_id, t.thread_key from app.mail_hidden_threads() t
		 where t.workspace_id = p_workspace_id
		   and not (t.hidden_label_ids operator(pg_catalog.&&) coalesce(p_label_ids, '{}'::uuid[]))
	)
	select m.*
	  from public.mail_messages m
	 where m.workspace_id = p_workspace_id
	   and (case when p_card_id is null then m.card_id is null else m.card_id = p_card_id end)
	   -- « Seulement moi » : la fonction de `CRM-139`, appelée et jamais recopiée (`CRM-160` la redéfinit).
	   and (not coalesce(p_only_me, false) or public.concerns_me(m))
	   -- Les pastilles activées, en OU, posées (§31.12.2).
	   and (coalesce(pg_catalog.cardinality(p_label_ids), 0) = 0 or exists (
			select 1 from public.mail_message_labels ml
			 where ml.message_id = m.id and ml.applied and ml.label_id = any (p_label_ids)))
	   -- L'expéditeur, sans casse (§32.9).
	   and (nullif(pg_catalog.btrim(p_sender), '') is null
	        or pg_catalog.lower(m.from_address) = pg_catalog.lower(pg_catalog.btrim(p_sender)))
	   and not exists (
			select 1 from masques k
			 where k.workspace_id = m.workspace_id
			   and k.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id))
	 -- L'ordre TOTAL, terminé par `id` (décision 185) ; la limite bornée côté serveur.
	 order by m.received_at desc, m.id desc
	 limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

comment on function public.inbox_messages(uuid, uuid, boolean, uuid[], text, integer) is
	'CRM-161 §35.2 — la liste de l''inbox d''UN espace (obligatoire : workspace_required) : « Non classés » (p_card_id '
	'nul) ou le dossier d''une affaire, « Seulement moi », les pastilles en OU, l''expéditeur, et les fils masqués écartés '
	'sauf pastille cachée activée (CRM-159 §31.13.4) ; sous la RLS.';

revoke all on function public.inbox_messages(uuid, uuid, boolean, uuid[], text, integer) from public, anon;
grant execute on function public.inbox_messages(uuid, uuid, boolean, uuid[], text, integer) to authenticated;

-- =============================================================================================
-- 2. La mention des fils masqués — §35.2 (reprise de `0193` §4)
-- =============================================================================================

drop function if exists public.inbox_hidden_counts(uuid, boolean, uuid[], text, boolean);

create or replace function public.inbox_hidden_counts(
	p_workspace_id   uuid,
	p_card_id        uuid    default null,
	p_only_me        boolean default false,
	p_label_ids      uuid[]  default '{}',
	p_sender         text    default null,
	p_snoozed_shown  boolean default false
)
returns table (label_id uuid, thread_count integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
	if p_workspace_id is null then
		raise exception 'workspace_required' using errcode = '22023';
	end if;
	return query
	with masques as materialized (
		select t.workspace_id, t.thread_key, t.hidden_label_ids from app.mail_hidden_threads() t
		 where t.workspace_id = p_workspace_id
		   and not (t.hidden_label_ids operator(pg_catalog.&&) coalesce(p_label_ids, '{}'::uuid[]))
	),
	candidats as materialized (
		select m.id, m.workspace_id, app.cle_fil(m.references_ids, m.rfc822_message_id) as thread_key
		  from public.mail_messages m
		 where m.workspace_id = p_workspace_id
		   and (case when p_card_id is null then m.card_id is null else m.card_id = p_card_id end)
		   and (not coalesce(p_only_me, false) or public.concerns_me(m))
		   and (nullif(pg_catalog.btrim(p_sender), '') is null
		        or pg_catalog.lower(m.from_address) = pg_catalog.lower(pg_catalog.btrim(p_sender)))
		   and (coalesce(p_snoozed_shown, false) or not exists (
				select 1 from public.mail_thread_snoozes s
				 where s.workspace_id = m.workspace_id
				   and s.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id)
				   and s.snoozed_until > pg_catalog.now()))
	)
	select l.id, pg_catalog.count(distinct (k.workspace_id, k.thread_key))::integer
	  from masques k
	 cross join lateral pg_catalog.unnest(k.hidden_label_ids) x(id)
	  join public.mail_labels l on l.id = x.id
	 where exists (
			select 1 from candidats c
			  join public.mail_message_labels ml on ml.message_id = c.id and ml.applied
			 where c.workspace_id = k.workspace_id and c.thread_key = k.thread_key
			   and (ml.label_id = x.id or ml.label_id = any (coalesce(p_label_ids, '{}'::uuid[]))))
	 group by l.id, l.name
	 order by l.name collate "fr-FR-x-icu", l.id;
end;
$$;

comment on function public.inbox_hidden_counts(uuid, uuid, boolean, uuid[], text, boolean) is
	'CRM-161 §35.2 — la mention sous la liste, dans UN espace (obligatoire) : pour chaque pastille cachée non activée, les '
	'fils masqués du dossier (mêmes filtres) qui paraîtraient si on l''activait (CRM-159 §31.13.5).';

revoke all on function public.inbox_hidden_counts(uuid, uuid, boolean, uuid[], text, boolean) from public, anon;
grant execute on function public.inbox_hidden_counts(uuid, uuid, boolean, uuid[], text, boolean) to authenticated;

-- =============================================================================================
-- 3. Les compteurs de l'arborescence — §35.2 (reprise de `0193` §5)
-- =============================================================================================

drop function if exists public.inbox_arborescence(boolean);

create or replace function public.inbox_arborescence(p_workspace_id uuid, p_only_me boolean default false)
returns table (track_id uuid, track_name text, channel_id uuid, channel_name text, card_id uuid, card_title text,
               nombre bigint, unread_count bigint)
language plpgsql
stable
set search_path = ''
as $$
begin
	if p_workspace_id is null then
		raise exception 'workspace_required' using errcode = '22023';
	end if;
	-- `CRM-111` T6.1 (décision 657) : une affaire partagée n'a qu'un dossier ; le track et le channel d'une ligne
	-- d'affaire sont nuls. La ligne des NON CLASSÉS vient toujours en premier, et existe même à zéro (§18.3).
	-- `CRM-139` : `p_only_me` ne compte que ce qui concerne l'appelant. `CRM-159` (§31.13.3) : les fils masqués n'y
	-- sont pas. `CRM-161` (§35.2) : un seul espace.
	return query
	with masques as materialized (
		select t.workspace_id, t.thread_key from app.mail_hidden_threads() t where t.workspace_id = p_workspace_id
	),
	visibles as (
		select m.id
		  from public.mail_messages m
		 where m.workspace_id = p_workspace_id
		   and (not coalesce(p_only_me, false) or public.concerns_me(m))
		   and not exists (
				select 1 from masques k
				 where k.workspace_id = m.workspace_id
				   and k.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id))
	)
	select x.track_id, x.track_name, x.channel_id, x.channel_name, x.card_id, x.card_title, x.nombre, x.unread_count
	  from (
		select null::uuid as track_id, null::text as track_name, null::uuid as channel_id, null::text as channel_name,
		       null::uuid as card_id, null::text as card_title, count(*) as nombre,
		       count(*) filter (where not public.is_read(m)) as unread_count
		  from public.mail_messages m
		 where m.card_id is null
		   and m.id in (select v.id from visibles v)
		union all
		select null::uuid, null::text, null::uuid, null::text, c.id, c.title, count(*),
		       count(*) filter (where not public.is_read(m))
		  from public.mail_messages m
		  join public.cards c on c.id = m.card_id
		 where m.id in (select v.id from visibles v)
		 group by c.id, c.title
	  ) x
	 order by x.card_id is not null, x.card_title collate "fr-FR-x-icu", x.card_id;
end;
$$;

comment on function public.inbox_arborescence(uuid, boolean) is
	'CRM-161 §35.2 — les dossiers de l''inbox d''UN espace (obligatoire) et leurs compteurs : « Non classés » d''abord, '
	'même à zéro, puis une ligne par affaire ; fils masqués exclus ; « Seulement moi » par concerns_me.';

revoke all on function public.inbox_arborescence(uuid, boolean) from public, anon;
grant execute on function public.inbox_arborescence(uuid, boolean) to authenticated, service_role;

-- =============================================================================================
-- 4. La portée des actions groupées — §35.3 (reprise de `0193` §6)
-- =============================================================================================

create or replace function app.inbox_scope_messages(p_scope jsonb)
 RETURNS TABLE(message_id uuid, workspace_id uuid, thread_key text, direction text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_dossier   text;
	v_card      uuid;
	v_moi       boolean;
	v_pastilles uuid[];
	v_expediteur text;
	v_sommeil   text;
	v_fils      jsonb;
	v_messages  uuid[];
	v_espace    uuid;
begin
	if p_scope is null or pg_catalog.jsonb_typeof(p_scope) <> 'object' then
		raise exception 'invalid_scope' using errcode = '22023';
	end if;

	-- LA LECTURE DES CHAMPS : une valeur d'un mauvais type (un identifiant mal formé, un tableau qui n'en est pas un)
	-- lève une erreur de la classe 22 ; elle devient `invalid_scope`, et seulement elle.
	begin
		v_dossier := p_scope ->> 'folder';
		-- `CRM-161` (§35.3) : l'espace de la portée, obligatoire.
		v_espace := (p_scope ->> 'workspace_id')::uuid;
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

	if v_espace is null or v_dossier is null or v_dossier not in ('unclassified', 'card', 'trash')
	   or (v_dossier = 'card' and v_card is null)
	   or (v_dossier = 'trash' and v_messages is null)
	   or v_sommeil not in ('hidden', 'shown') then
		raise exception 'invalid_scope' using errcode = '22023';
	end if;

	-- `CRM-161` (§35.3) : un fil nommé d'un autre espace que celui de la portée est refusé — un écran périmé ne doit pas
	-- croire avoir agi.
	if v_fils is not null and exists (
		select 1 from pg_catalog.jsonb_array_elements(v_fils) f where (f ->> 'workspace_id')::uuid <> v_espace
	) then
		raise exception 'thread_other_workspace' using errcode = '22023';
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
		   and m.workspace_id = v_espace
		   and app.message_en_corbeille_visible(m);
		return;
	end if;

	-- `CRM-159` (docs/SPEC-mail-subsystem.md §31.13.3) : « un fil coché agit sur les messages que la liste montre »
	-- (§32.2) ; un fil masqué n'est pas montré, sauf si l'une de ses pastilles cachées est dans `label_ids`.
	return query
	with masques as materialized (
		select t.workspace_id, t.thread_key from app.mail_hidden_threads() t
		 where not (t.hidden_label_ids operator(pg_catalog.&&) v_pastilles)
	)
	select m.id, m.workspace_id, app.cle_fil(m.references_ids, m.rfc822_message_id), m.direction
	  from public.mail_messages m
	 where m.deleted_at is null
	   and m.workspace_id = v_espace
	   and not exists (
			select 1 from masques k
			 where k.workspace_id = m.workspace_id
			   and k.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id))
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
$function$;

comment on function app.inbox_scope_messages(jsonb) is
	'CRM-156 §32.2 — la portée d''une action groupée : valide la description (invalid_scope, filter_required) et rend les '
	'messages qu''elle désigne parmi ceux que l''appelant voit. CRM-159 §31.13.3 : les fils masqués en sont écartés, sauf '
	'pastille cachée activée. CRM-161 §35.3 : workspace_id obligatoire ; un fil d''un autre espace : thread_other_workspace.';

revoke all on function app.inbox_scope_messages(jsonb) from public, anon, authenticated;

-- =============================================================================================
-- 5. Les non-lus de chaque espace — §35.4
-- =============================================================================================

create or replace function public.inbox_unread_by_workspace(p_only_me boolean default false)
returns table (workspace_id uuid, unread_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
	-- LES MÊMES RÈGLES QUE L'ARBORESCENCE, APPELÉE ET NON RECOPIÉE : la somme de ses non-lus, espace par espace. Les
	-- espaces sont ceux dont l'appelant est membre ; un espace sans non-lu rend 0.
	select w.id,
	       coalesce((select pg_catalog.sum(a.unread_count) from public.inbox_arborescence(w.id, p_only_me) a), 0)::integer
	  from public.workspaces w
	 where exists (select 1 from public.workspace_members wm
	                where wm.workspace_id = w.id and wm.user_id = (select auth.uid()))
	 order by w.name collate "fr-FR-x-icu", w.id;
$$;

comment on function public.inbox_unread_by_workspace(boolean) is
	'CRM-161 §35.4 — les non-lus de l''inbox de chaque espace dont l''appelant est membre, 0 compris : la somme des '
	'non-lus de inbox_arborescence, mêmes règles. Lecture du menu des espaces (SPEC-espace-courant §9).';

revoke all on function public.inbox_unread_by_workspace(boolean) from public, anon;
grant execute on function public.inbox_unread_by_workspace(boolean) to authenticated;
